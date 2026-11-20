import crypto from 'node:crypto';
import { addApiLog, persistState } from './store.ts';
import type { DatabaseState } from './types.ts';

export interface FamwiseCreateLinkResponse {
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  expires_at?: string;
  merchant_name?: string;
  upi_id?: string;
  payment_url?: string;
  qr_image_url?: string;
  upi_intent: string;
}

export interface FamwiseStatusResponse {
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  upi_id?: string;
  reference?: string;
  paid_at?: string;
  expires_at?: string;
}

export interface FamwiseResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}


function getFamwiseBaseUrl(state: DatabaseState): string {
  const raw = (state.famwiseConfig?.baseUrl || 'https://famwise.co').trim().replace(/\/+$/, '');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid Famwise base URL protocol');
  }
  return parsed.origin;
}

function extractGatewayError(parsed: unknown, httpStatus: number): string {
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj.error && typeof obj.error === 'object') {
      const msg = (obj.error as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (typeof obj.detail === 'string' && obj.detail.trim()) return obj.detail.trim();
    if (Array.isArray(obj.detail) && obj.detail.length > 0) {
      const first = obj.detail[0];
      if (first && typeof first === 'object' && 'msg' in first) {
        const msg = String((first as { msg: unknown }).msg || '').trim();
        if (msg) return msg;
      }
    }
  }
  return `Famwise returned HTTP ${httpStatus}`;
}

export function hasFamwiseCredentials(state: DatabaseState): boolean {
  return Boolean(state.famwiseConfig?.apiKey?.trim());
}

/**
 * Official Famwise Create Payment Link endpoint:
 * POST https://famwise.co/api/public/v1/payment-links/
 */
export async function createFamwisePaymentLink(
  state: DatabaseState,
  params: { amount: number; description: string; expiresInMinutes?: number }
): Promise<FamwiseResult<FamwiseCreateLinkResponse>> {
  const apiKey = state.famwiseConfig?.apiKey?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: 'Famwise payment gateway is not configured on the server.',
    };
  }

  let baseUrl: string;
  try {
    baseUrl = getFamwiseBaseUrl(state);
  } catch {
    return { ok: false, status: 400, error: 'Invalid Famwise base URL configured.' };
  }

  const endpointPath = '/api/public/v1/payment-links/';
  const url = new URL(endpointPath, baseUrl);
  const startedAt = Date.now();
  const timeoutMs = 15_000;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount: params.amount,
        description: params.description.slice(0, 140),
        expires_in_minutes: Math.min(43200, Math.max(5, params.expiresInMinutes ?? 30)),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - startedAt;
    const rawText = await response.text();
    let parsed: unknown = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = {};
    }

    const ok =
      response.ok &&
      Boolean(
        parsed &&
          typeof parsed === 'object' &&
          'order_id' in parsed &&
          'upi_intent' in parsed
      );

    const errorMessage = ok
      ? 'OK'
      : response.ok
        ? 'Gateway response is missing order_id or upi_intent.'
        : extractGatewayError(parsed, response.status);

    addApiLog(state, {
      endpoint: endpointPath,
      method: 'POST',
      statusCode: response.status,
      success: ok,
      latencyMs,
      message: errorMessage.slice(0, 450),
    });
    state.famwiseConfig.lastTestedAt = new Date().toISOString();
    state.famwiseConfig.lastStatus = ok ? 'connected' : 'error';
    state.famwiseConfig.lastMessage = ok ? 'Payment order created' : errorMessage;
    await persistState(state);

    if (!ok) {
      return {
        ok: false,
        status: response.ok ? 502 : response.status,
        error: errorMessage,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsed as FamwiseCreateLinkResponse,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const msg = isAbort
      ? `Famwise gateway timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : 'Network error reaching Famwise';
    addApiLog(state, {
      endpoint: endpointPath,
      method: 'POST',
      statusCode: 502,
      success: false,
      latencyMs,
      message: msg.slice(0, 450),
    });
    state.famwiseConfig.lastTestedAt = new Date().toISOString();
    state.famwiseConfig.lastStatus = 'error';
    state.famwiseConfig.lastMessage = msg;
    await persistState(state);
    return {
      ok: false,
      status: 502,
      error: isAbort
        ? 'Famwise gateway took too long to respond. Please try again.'
        : 'Could not reach the Famwise payment gateway.',
    };
  }
}

/**
 * Official Famwise Get Payment Link Status endpoint:
 * GET https://famwise.co/api/public/v1/payment-links/{order_id}
 */
export async function getFamwisePaymentStatus(
  state: DatabaseState,
  orderId: string
): Promise<FamwiseResult<FamwiseStatusResponse>> {
  const apiKey = state.famwiseConfig?.apiKey?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: 'Famwise payment gateway is not configured on the server.',
    };
  }

  let baseUrl: string;
  try {
    baseUrl = getFamwiseBaseUrl(state);
  } catch {
    return { ok: false, status: 400, error: 'Invalid Famwise base URL configured.' };
  }

  const endpointPath = `/api/public/v1/payment-links/${encodeURIComponent(orderId)}`;
  const url = new URL(endpointPath, baseUrl);
  const startedAt = Date.now();
  const timeoutMs = 12_000;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - startedAt;
    const rawText = await response.text();
    let parsed: unknown = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = {};
    }

    const ok = response.ok;
    const errorMessage = ok ? 'OK' : extractGatewayError(parsed, response.status);

    addApiLog(state, {
      endpoint: `/api/public/v1/payment-links/{order_id}`,
      method: 'GET',
      statusCode: response.status,
      success: ok,
      latencyMs,
      message: ok ? `Status: ${String((parsed as { status?: string })?.status || 'unknown')}` : errorMessage.slice(0, 450),
    });

    if (!ok) {
      return {
        ok: false,
        status: response.status,
        error: errorMessage,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsed as FamwiseStatusResponse,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const msg = isAbort
      ? `Famwise status check timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : 'Network error checking Famwise order';
    addApiLog(state, {
      endpoint: '/api/public/v1/payment-links/{order_id}',
      method: 'GET',
      statusCode: 502,
      success: false,
      latencyMs,
      message: msg.slice(0, 450),
    });
    return {
      ok: false,
      status: 502,
      error: isAbort
        ? 'Famwise status verification timed out. Please check again.'
        : 'Could not reach the Famwise payment gateway.',
    };
  }
}

/**
 * Safely tests whether the Famwise API key is accepted without creating an order.
 * A 404 on a non-existent order probe proves auth passed; 401 proves key is invalid/revoked.
 */
export async function testFamwiseConnection(
  state: DatabaseState
): Promise<{ connected: boolean; message: string; httpStatus: number }> {
  const apiKey = state.famwiseConfig?.apiKey?.trim();
  if (!apiKey) {
    return {
      connected: false,
      httpStatus: 503,
      message: 'Famwise API Key is not configured.',
    };
  }

  let baseUrl: string;
  try {
    baseUrl = getFamwiseBaseUrl(state);
  } catch {
    return { connected: false, httpStatus: 400, message: 'Invalid Famwise base URL.' };
  }

  const probeUrl = new URL('/api/public/v1/payment-links/FW_CONN_PROBE_000', baseUrl);
  const startedAt = Date.now();
  const timeoutMs = 10_000;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(probeUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;
    const body = await response.json().catch(() => ({}));

    const connected = response.status === 200 || response.status === 404;
    const message = connected
      ? 'Famwise API key verified and gateway reachable.'
      : response.status === 401
        ? 'Famwise API key was rejected (401 Unauthorized — check or rotate key).'
        : extractGatewayError(body, response.status);

    state.famwiseConfig.lastTestedAt = new Date().toISOString();
    state.famwiseConfig.lastStatus = connected ? 'connected' : 'error';
    state.famwiseConfig.lastMessage = message;
    addApiLog(state, {
      endpoint: '/api/public/v1/payment-links/{probe}',
      method: 'GET',
      statusCode: response.status,
      success: connected,
      latencyMs,
      message,
    });
    await persistState(state);

    return { connected, httpStatus: response.status, message };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? `Famwise gateway probe timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : 'Network error';
    state.famwiseConfig.lastTestedAt = new Date().toISOString();
    state.famwiseConfig.lastStatus = 'error';
    state.famwiseConfig.lastMessage = msg;
    await persistState(state);
    return { connected: false, httpStatus: 502, message: `Connection failed: ${msg}` };
  }
}

/**
 * Official Famwise webhook signature verifier:
 * Header: x-famwise-signature = "sha256=" + hmac_sha256(rawBody, secret)
 */
export function verifyFamwiseWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret || !secret.trim() || !signatureHeader) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', secret.trim())
    .update(rawBody)
    .digest('hex')}`;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader.trim(), 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
