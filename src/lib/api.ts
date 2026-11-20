const USER_TOKEN_KEY = 'kakarot_user_token';
const ADMIN_TOKEN_KEY = 'kakarot_admin_token';

export function getUserToken(): string | null {
  try {
    return localStorage.getItem(USER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setUserToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    else localStorage.removeItem(USER_TOKEN_KEY);
  } catch {
    // ignore storage quota errors
  }
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function extractCleanErrorMessage(rawText: string, status: number): string {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return `Request failed (HTTP ${status})`;
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    if (status === 404) {
      return 'Backend API endpoint returned 404 (Not Found). Ensure the Node.js Express backend server is running and /api/* routes are routed to it.';
    }
    return `Backend API returned an HTML error page (HTTP ${status}). Check Node.js server logs.`;
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    scope?: 'public' | 'user' | 'admin';
  } = {}
): Promise<T> {
  const { method = 'GET', body, scope = 'user' } = options;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (scope === 'user') {
    const token = getUserToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (scope === 'admin') {
    const token = getAdminToken();
    if (token) headers['x-admin-token'] = token;
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: extractCleanErrorMessage(text, res.status) };
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(errMsg);
  }

  return data as T;
}
