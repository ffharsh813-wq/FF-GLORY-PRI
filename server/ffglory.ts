import { addApiLog, persistState } from './store.ts';
import type { DatabaseState, PricingData, RegionInfo } from './types.ts';

export const DOCUMENTED_FALLBACK_REGIONS: RegionInfo[] = [
  { id: 'bd', region_name: 'Bangladesh', region_code: 'BD', tier: 'basic', enabled: true },
  { id: 'eu', region_name: 'Europe', region_code: 'EU', tier: 'basic', enabled: true },
  { id: 'in', region_name: 'India', region_code: 'IND', tier: 'basic', enabled: true },
  { id: 'id', region_name: 'Indonesia', region_code: 'ID', tier: 'basic', enabled: true },
  { id: 'me', region_name: 'Middle East', region_code: 'ME', tier: 'premium', enabled: true },
  { id: 'na', region_name: 'North America', region_code: 'NA', tier: 'basic', enabled: true },
  { id: 'pk', region_name: 'Pakistan', region_code: 'PK', tier: 'basic', enabled: true },
  { id: 'sg', region_name: 'Singapore', region_code: 'SG', tier: 'basic', enabled: true },
  { id: 'us', region_name: 'United States (US)', region_code: 'US', tier: 'basic', enabled: true },
  { id: 'vn', region_name: 'Vietnam', region_code: 'VN', tier: 'basic', enabled: true },
];

let cachedPricing: PricingData | null = null;
let cachedPricingAt = 0;


export function hasUpstreamCredentials(state: DatabaseState): boolean {
  return Boolean(state.apiConfig.masterKey.trim() && state.apiConfig.apiKey.trim());
}

export interface UpstreamCallResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

function parseSseFrames(rawText: string): Array<{ event: string; data: unknown }> {
  const frames: Array<{ event: string; data: unknown }> = [];
  const blocks = rawText.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) continue;
    const rawData = dataLines.join('\n');
    let parsed: unknown = rawData;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      // keep raw string
    }
    frames.push({ event: eventName, data: parsed });
  }
  return frames;
}

export async function callUpstreamApi<T = unknown>(
  state: DatabaseState,
  options: {
    method: 'GET' | 'POST';
    path: string;
    body?: Record<string, unknown>;
    requireApiKey?: boolean;
    requireMasterKey?: boolean;
    timeoutMs?: number;
  }
): Promise<UpstreamCallResult<T>> {
  const baseUrl = (state.apiConfig.baseUrl || 'https://ffglory.pro').replace(/\/+$/, '');
  const requireMaster = options.requireMasterKey !== false;
  const requireApiKey = options.requireApiKey !== false;

  if (requireMaster && !state.apiConfig.masterKey.trim()) {
    return {
      ok: false,
      status: 503,
      error:
        'Provider Master Key is not configured. Add it in Admin Panel → Provider Configuration or server environment variables.',
    };
  }
  if (requireApiKey && !state.apiConfig.apiKey.trim()) {
    return {
      ok: false,
      status: 503,
      error:
        'Provider API Key is not configured. Add it in Admin Panel → Provider Configuration or server environment variables.',
    };
  }

  const url = new URL(`${baseUrl}${options.path}`);
  if (requireApiKey && state.apiConfig.apiKey.trim()) {
    url.searchParams.set('api_key', state.apiConfig.apiKey.trim());
  }

  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
  };
  if (requireMaster && state.apiConfig.masterKey.trim()) {
    headers['x-api-key'] = state.apiConfig.masterKey.trim();
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const timeoutMs = options.timeoutMs ?? 12000;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url.toString(), {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - startedAt;
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    let parsed: unknown = null;
    let sseError: string | null = null;

    if (
      contentType.includes('text/event-stream') ||
      (rawText.includes('event:') && rawText.includes('data:'))
    ) {
      const frames = parseSseFrames(rawText);
      const errFrame = [...frames].reverse().find((f) => f.event === 'error');
      const doneFrame = [...frames].reverse().find((f) => f.event === 'done');
      if (errFrame) {
        parsed = errFrame.data;
        if (errFrame.data && typeof errFrame.data === 'object' && 'error' in errFrame.data) {
          sseError = String((errFrame.data as { error: unknown }).error);
        } else {
          sseError = 'Provider stream returned an error event';
        }
      } else if (doneFrame) {
        parsed = doneFrame.data;
        if (doneFrame.data && typeof doneFrame.data === 'object' && 'error' in doneFrame.data) {
          sseError = String((doneFrame.data as { error: unknown }).error);
        }
      } else if (frames.length > 0) {
        parsed = frames[frames.length - 1].data;
      }
    } else {
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = { raw: rawText.slice(0, 300) };
      }
    }

    const ok = response.ok && !sseError;
    const errorMessage = sseError
      ? sseError
      : !response.ok && parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : !response.ok
          ? `Provider returned HTTP ${response.status}`
          : 'OK';

    addApiLog(state, {
      endpoint: options.path,
      method: options.method,
      statusCode: response.status,
      success: ok,
      latencyMs,
      message: errorMessage.slice(0, 450),
      responsePreview: rawText.slice(0, 400),
    });

    state.apiConfig.lastTestedAt = new Date().toISOString();
    state.apiConfig.lastStatus = ok ? 'connected' : 'error';
    state.apiConfig.lastMessage = errorMessage;
    await persistState(state);

    if (!ok) {
      return {
        ok: false,
        status: response.ok ? 400 : response.status,
        data: parsed as T,
        error: errorMessage,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsed as T,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const msg = isAbort
      ? `Provider request timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : 'Network error calling provider API';
    addApiLog(state, {
      endpoint: options.path,
      method: options.method,
      statusCode: 502,
      success: false,
      latencyMs,
      message: msg.slice(0, 450),
    });
    state.apiConfig.lastTestedAt = new Date().toISOString();
    state.apiConfig.lastStatus = 'error';
    state.apiConfig.lastMessage = msg;
    await persistState(state);

    return {
      ok: false,
      status: 502,
      error: `Provider connection failed: ${msg}`,
    };
  }
}

export async function streamUpstreamAutoClanGroup(
  state: DatabaseState,
  body: { region: string; clan_id: string },
  onEvent?: (evt: { event: string; data: Record<string, unknown> }) => void
): Promise<
  UpstreamCallResult<{
    success?: boolean;
    group_id?: string;
    bot_count?: number;
    error?: string;
    [key: string]: unknown;
  }>
> {
  const baseUrl = (state.apiConfig.baseUrl || 'https://ffglory.pro').replace(/\/+$/, '');
  if (!state.apiConfig.masterKey.trim() || !state.apiConfig.apiKey.trim()) {
    return {
      ok: false,
      status: 503,
      error: 'Provider API or Master Key is not configured.',
    };
  }

  const url = new URL(`${baseUrl}/api/client/auto-clan-group`);
  url.searchParams.set('api_key', state.apiConfig.apiKey.trim());

  const timeoutMs = 120_000;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream, application/json',
        'Content-Type': 'application/json',
        'x-api-key': state.apiConfig.masterKey.trim(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';

    // Non-streaming JSON response (e.g. 200 JSON, 402/403/409, or non-SSE body)
    if (
      !response.body ||
      contentType.includes('application/json') ||
      (!contentType.includes('text/event-stream') && !response.ok)
    ) {
      clearTimeout(timeout);
      const rawText = await response.text();
      const latencyMs = Date.now() - startedAt;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        const frames = parseSseFrames(rawText);
        const done = [...frames].reverse().find((f) => f.event === 'done');
        const errF = [...frames].reverse().find((f) => f.event === 'error');
        parsed = (errF?.data || done?.data || {}) as Record<string, unknown>;
      }

      const errMsg =
        typeof parsed.error === 'string'
          ? parsed.error
          : !response.ok
            ? `Provider returned HTTP ${response.status}`
            : 'OK';

      addApiLog(state, {
        endpoint: '/api/client/auto-clan-group',
        method: 'POST',
        statusCode: response.status,
        success: response.ok && !parsed.error,
        latencyMs,
        message: errMsg.slice(0, 450),
        responsePreview: rawText.slice(0, 400),
      });
      await persistState(state);

      if (!response.ok || parsed.error) {
        return { ok: false, status: response.status, data: parsed, error: errMsg };
      }
      return { ok: true, status: response.status, data: parsed };
    }

    // Stream SSE frames live as they arrive
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawPreview = '';
    let donePayload: Record<string, unknown> | null = null;
    let errorPayload: Record<string, unknown> | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        if (rawPreview.length < 500) rawPreview += chunk;

        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || '';
        for (const part of parts) {
          for (const frame of parseSseFrames(part)) {
            const dataObj =
              frame.data && typeof frame.data === 'object'
                ? (frame.data as Record<string, unknown>)
                : { raw: frame.data };
            if (onEvent) onEvent({ event: frame.event, data: dataObj });
            if (frame.event === 'done') donePayload = dataObj;
            if (frame.event === 'error') errorPayload = dataObj;
          }
        }
      }
      if (done) break;
    }

    clearTimeout(timeout);

    if (buffer.trim()) {
      for (const frame of parseSseFrames(buffer)) {
        const dataObj =
          frame.data && typeof frame.data === 'object'
            ? (frame.data as Record<string, unknown>)
            : { raw: frame.data };
        if (onEvent) onEvent({ event: frame.event, data: dataObj });
        if (frame.event === 'done') donePayload = dataObj;
        if (frame.event === 'error') errorPayload = dataObj;
      }
    }

    // Fallback: if upstream returned plain JSON even with 200 OK
    if (!donePayload && !errorPayload && buffer.trim().startsWith('{')) {
      try {
        donePayload = JSON.parse(buffer.trim()) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }

    const latencyMs = Date.now() - startedAt;
    const finalError =
      errorPayload && typeof errorPayload.error === 'string'
        ? errorPayload.error
        : donePayload && typeof donePayload.error === 'string'
          ? donePayload.error
          : !donePayload?.group_id
            ? 'Provider did not return a group_id.'
            : null;

    addApiLog(state, {
      endpoint: '/api/client/auto-clan-group',
      method: 'POST',
      statusCode: finalError ? 400 : response.status,
      success: !finalError,
      latencyMs,
      message: (finalError || 'OK').slice(0, 450),
      responsePreview: rawPreview.slice(0, 400),
    });
    state.apiConfig.lastTestedAt = new Date().toISOString();
    state.apiConfig.lastStatus = finalError ? 'error' : 'connected';
    state.apiConfig.lastMessage = finalError || 'OK';
    await persistState(state);

    if (finalError) {
      return {
        ok: false,
        status: Number(errorPayload?.status || 400),
        data: errorPayload || donePayload || undefined,
        error: finalError,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: donePayload || {},
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const msg = isAbort
      ? `Provider launch timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : 'Stream connection failed';
    addApiLog(state, {
      endpoint: '/api/client/auto-clan-group',
      method: 'POST',
      statusCode: 502,
      success: false,
      latencyMs,
      message: msg.slice(0, 450),
    });
    await persistState(state);
    return {
      ok: false,
      status: 502,
      error: `Provider connection failed: ${msg}`,
    };
  }
}

export async function getLivePricing(state: DatabaseState, forceRefresh = false): Promise<PricingData> {
  const now = Date.now();
  if (!forceRefresh && cachedPricing && now - cachedPricingAt < 60_000) {
    return cachedPricing;
  }

  const res = await callUpstreamApi<{
    basic_credit_usd?: number;
    premium_credit_usd?: number;
    regions?: RegionInfo[];
  }>(state, {
    method: 'GET',
    path: '/api/pricing',
    requireApiKey: false,
    requireMasterKey: false,
    timeoutMs: 6000,
  });

  if (res.ok && res.data && Array.isArray(res.data.regions) && res.data.regions.length > 0) {
    cachedPricing = {
      basic_credit_usd: Number(res.data.basic_credit_usd ?? 1.5),
      premium_credit_usd: Number(res.data.premium_credit_usd ?? 3.0),
      regions: res.data.regions,
      source: 'upstream',
      fetchedAt: new Date().toISOString(),
    };
    cachedPricingAt = now;
    return cachedPricing;
  }

  if (cachedPricing && cachedPricing.regions.length > 0) {
    return {
      ...cachedPricing,
      upstreamError: res.error,
    };
  }

  return {
    basic_credit_usd: 1.5,
    premium_credit_usd: 3.0,
    regions: DOCUMENTED_FALLBACK_REGIONS,
    source: 'fallback',
    fetchedAt: new Date().toISOString(),
    upstreamError: res.error,
  };
}

export interface ProviderAccountSummary {
  connected: boolean;
  username?: string;
  role?: string;
  basic_credits?: number;
  premium_credits?: number;
  max_groups?: number;
  error?: string;
}

let cachedProviderSummary: ProviderAccountSummary | null = null;
let cachedProviderSummaryAt = 0;
let cachedProviderKeyDigest = '';
let inFlightProviderSummary: Promise<ProviderAccountSummary> | null = null;

export async function getProviderAccountSummary(
  state: DatabaseState,
  forceRefresh = false
): Promise<ProviderAccountSummary> {
  if (!hasUpstreamCredentials(state)) {
    return {
      connected: false,
      error: 'Provider API credentials are not configured.',
    };
  }

  const keyDigest = `${state.apiConfig.baseUrl}|${state.apiConfig.apiKey.slice(-6)}|${state.apiConfig.masterKey.slice(-6)}`;
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedProviderSummary &&
    cachedProviderKeyDigest === keyDigest &&
    now - cachedProviderSummaryAt < 25_000
  ) {
    return cachedProviderSummary;
  }

  if (inFlightProviderSummary && cachedProviderKeyDigest === keyDigest) {
    return inFlightProviderSummary;
  }

  const timeoutMs = 6000;
  cachedProviderKeyDigest = keyDigest;
  inFlightProviderSummary = (async (): Promise<ProviderAccountSummary> => {
    const meRes = await callUpstreamApi<{
      username?: string;
      role?: string;
      basic_credits?: number;
      premium_credits?: number;
      max_groups?: number;
    }>(state, {
      method: 'GET',
      path: '/api/auth/me',
      timeoutMs,
    });

    if (meRes.ok && meRes.data) {
      const summary: ProviderAccountSummary = {
        connected: true,
        username: meRes.data.username,
        role: meRes.data.role,
        basic_credits: Number(meRes.data.basic_credits ?? 0),
        premium_credits: Number(meRes.data.premium_credits ?? 0),
        max_groups: Number(meRes.data.max_groups ?? 0),
      };
      cachedProviderSummary = summary;
      cachedProviderSummaryAt = Date.now();
      return summary;
    }

    if (meRes.status === 429) {
      if (cachedProviderSummary?.connected) {
        return cachedProviderSummary;
      }
      return {
        connected: true,
        username: state.apiConfig.providerUsername || 'provider',
        error: 'Provider API temporarily rate-limited status check (HTTP 429). Retry in a few seconds.',
      };
    }

    // Skip slow sequential fallback when upstream timed out or is unreachable
    if (meRes.status === 502) {
      return {
        connected: false,
        error: meRes.error || 'Provider upstream timed out or is unreachable.',
      };
    }

    // Fallback check on /api/client/balance
    const balRes = await callUpstreamApi<{
      basic_credits?: number;
      premium_credits?: number;
    }>(state, {
      method: 'GET',
      path: '/api/client/balance',
      timeoutMs,
    });

    if (balRes.ok && balRes.data) {
      const summary: ProviderAccountSummary = {
        connected: true,
        username: state.apiConfig.providerUsername || undefined,
        basic_credits: Number(balRes.data.basic_credits ?? 0),
        premium_credits: Number(balRes.data.premium_credits ?? 0),
      };
      cachedProviderSummary = summary;
      cachedProviderSummaryAt = Date.now();
      return summary;
    }

    return {
      connected: false,
      error: meRes.error || balRes.error || 'Unable to verify provider account.',
    };
  })().finally(() => {
    inFlightProviderSummary = null;
  });

  return inFlightProviderSummary;
}
