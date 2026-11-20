import type { DatabaseState } from './types.ts';

export function getEffectiveYouTubeApiKey(state: DatabaseState): string {
  return (state.youtubeConfig?.apiKey || process.env.YOUTUBE_API_KEY || '').trim();
}

export function hasYouTubeApiKey(state: DatabaseState): boolean {
  return Boolean(getEffectiveYouTubeApiKey(state));
}

export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      return /^[a-zA-Z0-9_-]{6,32}$/.test(id) ? id : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{6,32}$/.test(vParam)) {
        return vParam;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v')
      ) {
        const candidate = parts[1];
        return /^[a-zA-Z0-9_-]{6,32}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export interface YouTubeMetadataResult {
  ok: boolean;
  missingApiKey?: boolean;
  error?: string;
  video?: {
    videoId: string;
    url: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    channelTitle: string;
    publishedAt?: string;
  };
}

export async function fetchYouTubeVideoMetadata(
  videoInput: string,
  apiKey: string
): Promise<YouTubeMetadataResult> {
  const videoId = extractYouTubeVideoId(videoInput);
  if (!videoId) {
    return { ok: false, error: 'Invalid YouTube video URL or video ID.' };
  }

  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return {
      ok: false,
      missingApiKey: true,
      error:
        'YOUTUBE_API_KEY is not configured. Add your YouTube Data API v3 key in Admin Panel → YouTube Videos or server environment variables.',
    };
  }

  try {
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    apiUrl.searchParams.set('part', 'snippet');
    apiUrl.searchParams.set('id', videoId);
    apiUrl.searchParams.set('key', cleanKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const raw = await resp.text();
    let parsed: {
      items?: Array<{
        id?: string;
        snippet?: {
          title?: string;
          description?: string;
          channelTitle?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
      }>;
      error?: { message?: string };
    } = {};

    try {
      parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
    } catch {
      return { ok: false, error: `YouTube API returned non-JSON response (HTTP ${resp.status}).` };
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: parsed.error?.message || `YouTube Data API v3 returned HTTP ${resp.status}.`,
      };
    }

    const item = parsed.items?.[0];
    if (!item || !item.snippet) {
      return {
        ok: false,
        error: 'Video not found or is private/unavailable on YouTube.',
      };
    }

    const thumbs = item.snippet.thumbnails || {};
    const thumbnailUrl =
      thumbs.maxres?.url ||
      thumbs.standard?.url ||
      thumbs.high?.url ||
      thumbs.medium?.url ||
      thumbs.default?.url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      ok: true,
      video: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: String(item.snippet.title || '').slice(0, 160),
        description: String(item.snippet.description || '').slice(0, 2000),
        thumbnailUrl,
        channelTitle: String(item.snippet.channelTitle || '').slice(0, 120),
        publishedAt: item.snippet.publishedAt,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to connect to YouTube Data API v3.',
    };
  }
}
