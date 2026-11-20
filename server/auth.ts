import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';

export interface SessionPayload {
  uid: string;
  username: string;
  role: 'user' | 'admin';
  scope: 'user' | 'admin';
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash || typeof storedHash !== 'string') return false;
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, keyHex] = parts;
    if (!salt || !keyHex) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

export function createSessionToken(
  payload: Omit<SessionPayload, 'exp'>,
  secret: string,
  ttlMs = 7 * 24 * 60 * 60 * 1000
): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined, secret: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractToken(req: Request, cookieName: string, headerName?: string): string | undefined {
  if (headerName) {
    const customHeader = req.headers[headerName.toLowerCase()];
    if (typeof customHeader === 'string' && customHeader.trim()) {
      return customHeader.trim();
    }
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = req.cookies as Record<string, string> | undefined;
  if (cookies && cookies[cookieName]) {
    return cookies[cookieName];
  }
  return undefined;
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return false;
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  const cfVisitor = req.headers['cf-visitor'];
  if (typeof cfVisitor === 'string' && cfVisitor.includes('"https"')) {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('https://')) {
    return true;
  }
  return false;
}

export function setAuthCookie(res: Response, name: string, token: string, req?: Request): void {
  const secure = isHttpsRequest(req);
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response, name: string, req?: Request): void {
  const secure = isHttpsRequest(req);
  res.clearCookie(name, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
  });
}

function getFirebaseProjectConfig(): { projectId?: string; apiKey?: string } {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        projectId?: string;
        apiKey?: string;
      };
    }
  } catch {
    // ignore
  }
  return {};
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedAud?: string
): Promise<{ email: string; emailVerified: boolean; sub: string; name?: string } | null> {
  const fbCfg = getFirebaseProjectConfig();

  // 1. Verify Firebase Auth ID token using Firebase Admin SDK (no IAM needed for verifyIdToken)
  if (fbCfg.projectId) {
    try {
      const { getApps, initializeApp } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const app = getApps().length ? getApps()[0] : initializeApp({ projectId: fbCfg.projectId });
      const decoded = await getAuth(app).verifyIdToken(idToken);
      if (decoded.email && decoded.email_verified) {
        return {
          email: decoded.email.toLowerCase(),
          emailVerified: Boolean(decoded.email_verified),
          sub: decoded.uid,
          name: typeof decoded.name === 'string' ? decoded.name : undefined,
        };
      }
    } catch {
      // Fall through to REST lookup / Google tokeninfo
    }
  }

  // 2. Verify Firebase Auth ID token via Identity Toolkit accounts:lookup using public Web API key
  if (fbCfg.apiKey) {
    try {
      const lookupResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbCfg.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (lookupResp.ok) {
        const lookupData = (await lookupResp.json()) as {
          users?: Array<{
            localId?: string;
            email?: string;
            emailVerified?: boolean;
            displayName?: string;
          }>;
        };
        const u = lookupData.users?.[0];
        if (u?.email && u.emailVerified && u.localId) {
          return {
            email: u.email.toLowerCase(),
            emailVerified: true,
            sub: u.localId,
            name: u.displayName,
          };
        }
      }
    } catch {
      // Fall through to Google tokeninfo
    }
  }

  // 3. Fallback: direct Google OAuth ID token verification
  try {
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      email?: string;
      email_verified?: string | boolean;
      sub?: string;
      name?: string;
      aud?: string;
    };
    if (!data.email || !data.sub) return null;
    const verified = data.email_verified === true || data.email_verified === 'true';
    if (!verified) return null;
    if (expectedAud && data.aud && data.aud !== expectedAud) {
      if (!data.aud.startsWith(expectedAud.split('-')[0])) {
        return null;
      }
    }
    return {
      email: data.email.toLowerCase(),
      emailVerified: verified,
      sub: data.sub,
      name: data.name,
    };
  } catch {
    return null;
  }
}
