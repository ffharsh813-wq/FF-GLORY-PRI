import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  clearAuthCookie,
  createSessionToken,
  extractToken,
  hashPassword,
  setAuthCookie,
  verifyGoogleIdToken,
  verifyPassword,
  verifySessionToken,
} from './auth.ts';
import {
  callUpstreamApi,
  DOCUMENTED_FALLBACK_REGIONS,
  getLivePricing,
  getProviderAccountSummary,
  hasUpstreamCredentials,
  streamUpstreamAutoClanGroup,
} from './ffglory.ts';

function pricingCacheRegionFallback(regionCodeOrId: string): string {
  const q = String(regionCodeOrId || '').trim().toLowerCase();
  if (!q) return 'India';
  const match = DOCUMENTED_FALLBACK_REGIONS.find(
    (r) => r.id.toLowerCase() === q || r.region_code.toLowerCase() === q || (q === 'in' && r.id === 'in')
  );
  return match ? match.region_name : regionCodeOrId.toUpperCase();
}
import {
  createFamwisePaymentLink,
  getFamwisePaymentStatus,
  hasFamwiseCredentials,
  testFamwiseConnection,
  verifyFamwiseWebhookSignature,
} from './famwise.ts';
import {
  parseValidDepositAmount,
  roundInr,
  verifyAndCreditDeposit,
} from './addFundsService.ts';
import {
  BackupPassphraseRequiredError,
  buildHostDeploymentEnvText,
  createEncryptedBackup,
  createPlainBackup,
  parseAnyBackupPayload,
} from './backupService.ts';
import { buildSourceCodeZip } from './sourceZipService.ts';
import {
  extractYouTubeVideoId,
  fetchYouTubeVideoMetadata,
  getEffectiveYouTubeApiKey,
  hasYouTubeApiKey,
} from './youtube.ts';
import {
  addActivityLog,
  addCreditAudit,
  addNotification,
  addTransaction,
  findCoupon,
  generateCouponCode,
  getDeploymentStatus,
  loadState,
  maskSecret,
  persistState,
  toPublicUser,
  upsertGroup,
} from './store.ts';
import type {
  ActivityLogRecord,
  ClanInfoPayload,
  DatabaseState,
  GroupBotDetail,
  GroupRecord,
  UserRecord,
  YouTubeVideoRecord,
} from './types.ts';

const USER_COOKIE = 'kakarot_user_token';
const ADMIN_COOKIE = 'kakarot_admin_token';

const redeemAttempts = new Map<string, number[]>();
const depositCreateAttempts = new Map<string, number[]>();
const depositStatusAttempts = new Map<string, number[]>();
const activeLaunches = new Set<string>();
const publicEventClients = new Set<Response>();

function broadcastPublicEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of publicEventClients) {
    try {
      client.write(payload);
    } catch {
      publicEventClients.delete(client);
    }
  }
}

function getGoogleClientId(): string | undefined {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { oAuthClientId?: string };
      return cfg.oAuthClientId;
    }
  } catch {
    // ignore
  }
  return undefined;
}

interface AuthedRequest extends Request {
  authUser?: UserRecord;
  dbState?: DatabaseState;
  rawBody?: Buffer;
}

export function createApp(): express.Express {
  const app = express();

  // Wrap async route handlers/middlewares so Express 4 forwards rejections to error middleware instead of crashing Lambda (502)
  const wrapAsyncArg = (fn: unknown): unknown => {
    if (typeof fn !== 'function' || fn.length === 4) return fn;
    return function wrappedHandler(req: Request, res: Response, next: NextFunction) {
      try {
        const result = (fn as (...args: unknown[]) => unknown)(req, res, next);
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch(next);
        }
      } catch (err) {
        next(err);
      }
    };
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const original = app[method].bind(app) as (...args: unknown[]) => express.Express;
    (app as unknown as Record<string, (...args: unknown[]) => express.Express>)[method] = (
      pathArg: unknown,
      ...handlers: unknown[]
    ) => {
      if (handlers.length === 0) {
        return original(pathArg);
      }
      return original(pathArg, ...handlers.map(wrapAsyncArg));
    };
  }

  app.use(
    express.json({
      limit: '15mb',
      verify: (req, _res, buf) => {
        (req as AuthedRequest).rawBody = buf;
      },
    })
  );
  app.use(cookieParser());

  async function requireUser(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
    const state = await loadState();
    const token = extractToken(req, USER_COOKIE);
    const payload = verifySessionToken(token, state.sessionSecret);
    if (!payload || payload.scope !== 'user') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const user = state.users.find((u) => u.id === payload.uid);
    if (!user) {
      res.status(401).json({ error: 'Session user not found' });
      return;
    }
    if (user.blocked) {
      res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
      return;
    }
    if (state.settings.maintenanceMode && user.role !== 'admin') {
      res.status(503).json({ error: 'Website is currently under maintenance. Please try again later.' });
      return;
    }
    req.authUser = user;
    req.dbState = state;
    next();
  }

  async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
    const state = await loadState();
    const cookies = req.cookies as Record<string, string> | undefined;
    const candidates = [
      extractToken(req, ADMIN_COOKIE, 'x-admin-token'),
      cookies?.[ADMIN_COOKIE],
    ].filter((t): t is string => Boolean(t && t.trim()));

    let validPayload: ReturnType<typeof verifySessionToken> = null;
    for (const candidate of candidates) {
      const p = verifySessionToken(candidate, state.sessionSecret);
      if (p && p.scope === 'admin' && p.role === 'admin') {
        validPayload = p;
        break;
      }
    }

    if (!validPayload) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }
    const admin = state.users.find((u) => u.id === validPayload.uid && u.role === 'admin');
    if (!admin) {
      res.status(403).json({ error: 'Forbidden: Admin privileges revoked or missing' });
      return;
    }
    req.authUser = admin;
    req.dbState = state;
    next();
  }

  // ==========================================
  // PUBLIC ENDPOINTS
  // ==========================================

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'kakarot-glory-pro', timestamp: new Date().toISOString() });
  });

  app.get('/api/public/settings', async (_req, res) => {
    const state = await loadState();
    res.json(state.settings);
  });

  app.get('/api/public/events', async (req, res) => {
    const state = await loadState();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const publishedVideos = state.youtubeVideos
      .filter((v) => v.published)
      .sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));

    res.write('retry: 30000\n\n');
    res.write(`event: settings\ndata: ${JSON.stringify(state.settings)}\n\n`);
    res.write(`event: youtube\ndata: ${JSON.stringify(publishedVideos)}\n\n`);

    publicEventClients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        publicEventClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      publicEventClients.delete(res);
    });
  });

  app.get('/api/youtube/videos', async (_req, res) => {
    const state = await loadState();
    const published = state.youtubeVideos
      .filter((v) => v.published)
      .sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    res.json({
      configured: hasYouTubeApiKey(state),
      videos: published,
    });
  });

  app.get('/api/pricing', async (req, res) => {
    const state = await loadState();
    const force = req.query.refresh === '1';
    const pricing = await getLivePricing(state, force);
    res.json({
      ...pricing,
      basic_credit_inr: state.famwiseConfig.basicCreditInr || 80,
      premium_credit_inr: state.famwiseConfig.premiumCreditInr || 160,
    });
  });

  // ==========================================
  // USER AUTHENTICATION
  // ==========================================

  app.post('/api/auth/signup', async (req, res) => {
    const state = await loadState();
    if (!state.settings.registrationEnabled) {
      res.status(403).json({ error: 'Registration is currently disabled by the administrator.' });
      return;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      username?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
    };

    const cleanUsername = String(body.username || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const confirmPassword = body.confirmPassword;

    if (!/^[a-z0-9_.-]{3,24}$/.test(cleanUsername)) {
      res.status(400).json({
        error: 'Username must be 3-24 characters using letters, numbers, underscore, dot, or hyphen.',
      });
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    if (confirmPassword !== undefined && confirmPassword !== '' && password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    if (state.users.some((u) => u.username === cleanUsername)) {
      res.status(409).json({ error: 'Username is already taken.' });
      return;
    }
    if (state.users.some((u) => u.email === cleanEmail)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const newUser: UserRecord = {
      id: `usr_${crypto.randomBytes(8).toString('hex')}`,
      username: cleanUsername,
      email: cleanEmail,
      passwordHash: hashPassword(password),
      role: 'user',
      basicCredits: 0,
      premiumCredits: 0,
      walletBalance: 0,
      maxGroups: 100,
      blocked: false,
      language: 'en',
      authProvider: 'password',
      createdAt: now,
      updatedAt: now,
    };

    state.users.push(newUser);
    addNotification(state, {
      userId: newUser.id,
      type: 'success',
      title: `Welcome to ${state.settings.websiteName}`,
      message: 'Your account is active. Redeem a coupon or add credits to launch a glory group.',
    });
    await persistState(state);

    const token = createSessionToken(
      { uid: newUser.id, username: newUser.username, role: 'user', scope: 'user' },
      state.sessionSecret
    );
    setAuthCookie(res, USER_COOKIE, token, req);
    res.status(201).json({ token, user: toPublicUser(newUser) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const state = await loadState();
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      username?: string;
      password?: string;
    };
    const identifier = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }

    const user = state.users.find(
      (u) => u.role === 'user' && (u.username === identifier || u.email === identifier)
    );
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    if (user.blocked) {
      res.status(403).json({ error: 'Account is blocked. Contact administrator.' });
      return;
    }
    if (state.settings.maintenanceMode) {
      res.status(503).json({ error: 'Website is currently in maintenance mode.' });
      return;
    }

    const token = createSessionToken(
      { uid: user.id, username: user.username, role: 'user', scope: 'user' },
      state.sessionSecret
    );
    setAuthCookie(res, USER_COOKIE, token, req);
    res.json({ token, user: toPublicUser(user) });
  });

  app.post('/api/auth/google', async (req, res) => {
    const state = await loadState();
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      res.status(400).json({ error: 'Missing Google ID token.' });
      return;
    }

    const verified = await verifyGoogleIdToken(idToken, getGoogleClientId());
    if (!verified) {
      res.status(401).json({ error: 'Invalid or unverified Google token.' });
      return;
    }

    let user = state.users.find((u) => u.email === verified.email && u.role === 'user');
    if (!user) {
      if (!state.settings.registrationEnabled) {
        res.status(403).json({ error: 'Registration is currently disabled.' });
        return;
      }
      const baseUsername = (verified.email.split('@')[0] || 'player')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 14);
      let candidate = baseUsername.length >= 3 ? baseUsername : `usr_${baseUsername}`;
      while (state.users.some((u) => u.username === candidate)) {
        candidate = `${baseUsername.slice(0, 12)}_${crypto.randomInt(10, 99)}`;
      }
      const now = new Date().toISOString();
      user = {
        id: `usr_${crypto.randomBytes(8).toString('hex')}`,
        username: candidate,
        email: verified.email,
        passwordHash: hashPassword(crypto.randomBytes(24).toString('hex')),
        role: 'user',
        basicCredits: 0,
        premiumCredits: 0,
        walletBalance: 0,
        maxGroups: 100,
        blocked: false,
        language: 'en',
        authProvider: 'google',
        createdAt: now,
        updatedAt: now,
      };
      state.users.push(user);
      addNotification(state, {
        userId: user.id,
        type: 'success',
        title: `Welcome to ${state.settings.websiteName}`,
        message: 'Signed in via Google. Your account is ready.',
      });
      await persistState(state);
    }

    if (user.blocked) {
      res.status(403).json({ error: 'Account is blocked.' });
      return;
    }
    if (state.settings.maintenanceMode) {
      res.status(503).json({ error: 'Website is currently in maintenance mode.' });
      return;
    }

    const token = createSessionToken(
      { uid: user.id, username: user.username, role: 'user', scope: 'user' },
      state.sessionSecret
    );
    setAuthCookie(res, USER_COOKIE, token, req);
    res.json({ token, user: toPublicUser(user) });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const state = await loadState();
    const { username, email } = req.body as { username?: string; email?: string };
    const cleanUsername = (username || '').trim().toLowerCase();
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanUsername || !cleanEmail) {
      res.status(400).json({ error: 'Both username and registered email are required.' });
      return;
    }

    const user = state.users.find(
      (u) => u.role === 'user' && u.username === cleanUsername && u.email === cleanEmail
    );
    if (!user) {
      res.status(404).json({ error: 'No matching account found for that username and email.' });
      return;
    }

    const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
    user.resetToken = resetToken;
    user.resetTokenExpiresAt = Date.now() + 15 * 60 * 1000;
    await persistState(state);

    res.json({
      success: true,
      message: 'Verification code generated. Use it below to set a new password (valid for 15 minutes).',
      resetCode: resetToken,
    });
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const state = await loadState();
    const { username, email, resetCode, newPassword, confirmPassword } = req.body as {
      username?: string;
      email?: string;
      resetCode?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const cleanUsername = (username || '').trim().toLowerCase();
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = state.users.find(
      (u) => u.role === 'user' && u.username === cleanUsername && u.email === cleanEmail
    );

    if (
      !user ||
      !user.resetToken ||
      !user.resetTokenExpiresAt ||
      Date.now() > user.resetTokenExpiresAt ||
      user.resetToken !== (resetCode || '').trim().toUpperCase()
    ) {
      res.status(400).json({ error: 'Invalid or expired reset code.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    user.passwordHash = hashPassword(newPassword);
    user.resetToken = undefined;
    user.resetTokenExpiresAt = undefined;
    user.updatedAt = new Date().toISOString();
    await persistState(state);

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(res, USER_COOKIE, req);
    res.json({ success: true });
  });

  app.get('/api/auth/me', requireUser, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    res.json({
      ...toPublicUser(user),
      basic_credits: user.basicCredits,
      premium_credits: user.premiumCredits,
      max_groups: user.maxGroups,
    });
  });

  app.post('/api/auth/change-password', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { currentPassword, newPassword, confirmNewPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
      confirmNewPassword?: string;
    };

    if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      res.status(400).json({ error: 'New passwords do not match.' });
      return;
    }

    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, message: 'Password updated successfully.' });
  });

  app.patch('/api/account/settings', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { language, email } = req.body as { language?: string; email?: string };

    if (language && typeof language === 'string' && language.length <= 10) {
      user.language = language;
    }
    if (email && typeof email === 'string') {
      const cleanEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({ error: 'Invalid email address.' });
        return;
      }
      if (state.users.some((u) => u.id !== user.id && u.email === cleanEmail)) {
        res.status(409).json({ error: 'Email is already in use by another account.' });
        return;
      }
      user.email = cleanEmail;
    }

    user.updatedAt = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, user: toPublicUser(user) });
  });

  // ==========================================
  // USER DASHBOARD: CREDITS & GROUPS (PROVIDER-CONNECTED)
  // ==========================================

  app.get('/api/client/balance', requireUser, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    res.json({
      basic_credits: user.basicCredits,
      premium_credits: user.premiumCredits,
    });
  });

  app.post('/api/client/add-credits-request', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { basic_credits, premium_credits, note } = req.body as {
      basic_credits?: number;
      premium_credits?: number;
      note?: string;
    };

    const basic = Math.max(0, Math.min(100000, Math.floor(Number(basic_credits) || 0)));
    const premium = Math.max(0, Math.min(100000, Math.floor(Number(premium_credits) || 0)));
    if (basic + premium <= 0) {
      res.status(400).json({ error: 'Specify at least 1 Basic or Premium credit to request.' });
      return;
    }

    const txn = addTransaction(state, {
      userId: user.id,
      username: user.username,
      type: 'purchase',
      basic_credits: basic,
      premium_credits: premium,
      status: 'pending',
      details: note ? String(note).slice(0, 200) : 'Credit top-up request awaiting admin approval',
    });

    await persistState(state);
    res.status(201).json({ success: true, transaction: txn });
  });

  // ==========================================
  // AUTOMATIC ADD FUNDS (FAMWISE UPI GATEWAY)
  // ==========================================

  app.get('/api/add-funds/config', requireUser, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    res.json({
      configured: hasFamwiseCredentials(state),
      upiId: state.famwiseConfig.upiId || '',
      basicCreditInr: state.famwiseConfig.basicCreditInr || 80,
      premiumCreditInr: state.famwiseConfig.premiumCreditInr || 160,
      walletBalance: roundInr(user.walletBalance ?? 0),
    });
  });

  app.post('/api/add-funds/create', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;

    const nowMs = Date.now();
    const recent = (depositCreateAttempts.get(user.id) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 10) {
      res.status(429).json({ error: 'Rate limit exceeded. Please wait before creating another order.' });
      return;
    }
    recent.push(nowMs);
    depositCreateAttempts.set(user.id, recent);

    if (!hasFamwiseCredentials(state)) {
      res.status(503).json({ error: 'Famwise payment gateway is not configured by the administrator.' });
      return;
    }

    const validAmount = parseValidDepositAmount((req.body as { amount?: unknown })?.amount);
    if (validAmount === null) {
      res.status(400).json({ error: 'Enter a valid deposit amount (minimum ₹1, maximum ₹100,000, up to 2 decimal places).' });
      return;
    }

    const gw = await createFamwisePaymentLink(state, {
      amount: validAmount,
      description: `${state.settings.websiteName} Add Funds - ${user.username}`,
      expiresInMinutes: 30,
    });

    if (!gw.ok || !gw.data) {
      res.status(gw.status >= 400 ? gw.status : 502).json({
        ok: false,
        error: gw.error || 'Could not create Famwise payment order.',
      });
      return;
    }

    const orderId = String(gw.data.order_id).trim();
    if (!orderId || !gw.data.upi_intent) {
      res.status(502).json({ ok: false, error: 'Gateway returned incomplete order details.' });
      return;
    }

    if (state.deposits.some((d) => d.orderId === orderId)) {
      res.status(409).json({ ok: false, error: 'Duplicate gateway order ID received.' });
      return;
    }

    const now = new Date().toISOString();
    const depositAmount = roundInr(Number(gw.data.amount ?? validAmount));
    const deposit = {
      id: `dep_${crypto.randomBytes(6).toString('hex')}`,
      orderId,
      userId: user.id,
      username: user.username,
      amount: depositAmount,
      currency: 'INR' as const,
      status: 'active' as const,
      credited: false,
      creditedAt: null,
      upiIntent: String(gw.data.upi_intent),
      paymentUrl: String(gw.data.payment_url || ''),
      qrImageUrl: String(gw.data.qr_image_url || ''),
      merchantName: String(gw.data.merchant_name || state.settings.websiteName),
      upiId: String(gw.data.upi_id || state.famwiseConfig.upiId || ''),
      expiresAt: gw.data.expires_at ? String(gw.data.expires_at) : null,
      createdAt: now,
      updatedAt: now,
    };

    state.deposits.unshift(deposit);
    if (state.deposits.length > 5000) {
      state.deposits = state.deposits.slice(0, 5000);
    }
    await persistState(state);

    res.status(201).json({
      ok: true,
      deposit,
    });
  });

  app.get('/api/add-funds/status/:orderId', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const orderId = String(req.params.orderId || '').trim();

    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(orderId)) {
      res.status(400).json({ ok: false, error: 'Invalid order ID format.' });
      return;
    }

    const nowMs = Date.now();
    const recent = (depositStatusAttempts.get(user.id) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 30) {
      res.status(429).json({ ok: false, error: 'Too many status checks. Please wait a few seconds.' });
      return;
    }
    recent.push(nowMs);
    depositStatusAttempts.set(user.id, recent);

    const result = await verifyAndCreditDeposit({
      state,
      orderId,
      expectedUserId: user.id,
      fetchGatewayStatus: (id) => getFamwisePaymentStatus(state, id),
    });

    if (!result.ok) {
      res.status(result.httpStatus).json({
        ok: false,
        orderId: result.orderId,
        status: result.status,
        error: result.message,
      });
      return;
    }

    res.json({
      ok: true,
      orderId: result.orderId,
      status: result.status,
      amount: result.amount,
      walletBalance: result.walletBalance,
      walletCreditApplied: result.walletCreditApplied,
      alreadyCredited: result.alreadyCredited,
      deposit: result.deposit,
      message: result.message,
    });
  });

  app.get('/api/add-funds/history', requireUser, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;

    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(25, Math.max(1, Math.floor(Number(req.query.limit) || 5)));

    const mine = state.deposits
      .filter((d) => d.userId === user.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const total = mine.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const deposits = mine.slice(start, start + limit);

    res.json({
      ok: true,
      deposits,
      page: safePage,
      limit,
      total,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: safePage < totalPages,
      walletBalance: roundInr(user.walletBalance ?? 0),
    });
  });

  app.post('/api/add-funds/buy-credits', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { creditType, quantity } = req.body as {
      creditType?: 'basic' | 'premium';
      quantity?: number;
    };

    if (creditType !== 'basic' && creditType !== 'premium') {
      res.status(400).json({ error: 'Select basic or premium credits.' });
      return;
    }
    const qty = Math.floor(Number(quantity) || 0);
    if (!Number.isFinite(qty) || qty < 1 || qty > 1000) {
      res.status(400).json({ error: 'Quantity must be between 1 and 1000.' });
      return;
    }

    const unitPrice =
      creditType === 'basic'
        ? state.famwiseConfig.basicCreditInr || 80
        : state.famwiseConfig.premiumCreditInr || 160;
    const totalCost = roundInr(qty * unitPrice);
    const currentWallet = roundInr(user.walletBalance ?? 0);

    if (currentWallet < totalCost) {
      res.status(402).json({
        error: `Insufficient wallet balance. Need ₹${totalCost.toFixed(2)}, available ₹${currentWallet.toFixed(2)}.`,
      });
      return;
    }

    user.walletBalance = roundInr(currentWallet - totalCost);
    if (creditType === 'basic') {
      user.basicCredits += qty;
    } else {
      user.premiumCredits += qty;
    }
    user.updatedAt = new Date().toISOString();

    addTransaction(state, {
      userId: user.id,
      username: user.username,
      type: 'wallet_spend',
      basic_credits: creditType === 'basic' ? qty : 0,
      premium_credits: creditType === 'premium' ? qty : 0,
      amount_inr: -totalCost,
      status: 'completed',
      details: `Purchased ${qty} ${creditType} credit(s) from ₹ Wallet (₹${totalCost.toFixed(2)})`,
    });

    await persistState(state);
    res.json({
      ok: true,
      user: toPublicUser(user),
      walletBalance: user.walletBalance,
      basicCredits: user.basicCredits,
      premiumCredits: user.premiumCredits,
      message: `Purchased ${qty} ${creditType} credit(s) for ₹${totalCost.toFixed(2)}.`,
    });
  });

  app.post('/api/add-funds/webhook', async (req: AuthedRequest, res) => {
    const state = await loadState();
    const secret = state.famwiseConfig?.webhookSecret?.trim();
    const signature = req.header('x-famwise-signature') || undefined;
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});

    if (!secret) {
      res.status(503).json({ ok: false, error: 'Webhook secret not configured.' });
      return;
    }
    if (!verifyFamwiseWebhookSignature(rawBody, signature, secret)) {
      res.status(401).json({ ok: false, error: 'Invalid webhook signature.' });
      return;
    }

    const payload = (req.body || {}) as {
      event?: string;
      data?: { order_id?: string; reference?: string };
      order_id?: string;
    };
    const orderId = String(payload.data?.order_id || payload.order_id || '').trim();
    if (!orderId || !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId)) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    await verifyAndCreditDeposit({
      state,
      orderId,
      fetchGatewayStatus: (id) => getFamwisePaymentStatus(state, id),
    });

    res.status(200).json({ ok: true });
  });

  async function enrichGroupWithGloryAndClan(state: DatabaseState, group: GroupRecord): Promise<void> {
    if (!hasUpstreamCredentials(state)) return;

    const [gloryRes, clanRes] = await Promise.all([
      callUpstreamApi<{
        total_glory?: number;
        glory?: number;
        glory_farmed?: number;
        details?: GroupBotDetail[];
        can_extend?: boolean;
        can_replace?: boolean;
        extend_count?: number;
        max_extends?: number;
        max_replaces?: number;
        extend_price?: number;
        replace_count?: number;
      }>(state, {
        method: 'POST',
        path: '/api/client/group-action',
        body: { action: 'get-glory', group_id: group.group_id },
      }),
      callUpstreamApi<ClanInfoPayload>(state, {
        method: 'POST',
        path: '/api/client/group-action',
        body: { action: 'get-clan-info', group_id: group.group_id },
      }),
    ]);

    const now = new Date().toISOString();
    if (gloryRes.ok && gloryRes.data) {
      const gVal = Number(
        gloryRes.data.total_glory ?? gloryRes.data.glory ?? gloryRes.data.glory_farmed ?? group.glory_farmed
      );
      if (!Number.isNaN(gVal)) {
        group.glory_farmed = gVal;
        const snapshots = Array.isArray(group.glory_snapshots) ? group.glory_snapshots : [];
        const lastSnap = snapshots[snapshots.length - 1];
        if (!lastSnap || lastSnap.total_glory !== gVal) {
          const elapsedHours = Math.max(
            0,
            Number(((Date.now() - Date.parse(group.created_at || now)) / 3_600_000).toFixed(2))
          );
          snapshots.push({
            captured_at: now,
            total_glory: gVal,
            uptime_hours: elapsedHours,
          });
          group.glory_snapshots = snapshots.slice(-50);
        }
      }
      if (Array.isArray(gloryRes.data.details)) {
        group.glory_details = gloryRes.data.details;
      }
      if (typeof gloryRes.data.can_extend === 'boolean') group.can_extend = gloryRes.data.can_extend;
      if (typeof gloryRes.data.can_replace === 'boolean') group.can_replace = gloryRes.data.can_replace;
      if (typeof gloryRes.data.extend_count === 'number') group.extend_count = gloryRes.data.extend_count;
      if (typeof gloryRes.data.replace_count === 'number') group.replace_count = gloryRes.data.replace_count;
      if (typeof gloryRes.data.max_extends === 'number') group.max_extends = gloryRes.data.max_extends;
      if (typeof gloryRes.data.max_replaces === 'number') group.max_replaces = gloryRes.data.max_replaces;
      if (typeof gloryRes.data.extend_price === 'number') group.extend_price = gloryRes.data.extend_price;
    }

    if (clanRes.ok && clanRes.data && typeof clanRes.data === 'object' && !('raw' in clanRes.data)) {
      group.clan_info = clanRes.data;
      const clanName = clanRes.data.decoded?.clan_name;
      if (clanName) {
        for (const l of state.activityLogs) {
          if (l.clan_id === group.clan_id && !l.clan_name) {
            l.clan_name = clanName;
          }
        }
      }
    }
    group.glory_synced_at = now;
    group.updated_at = now;
  }

  app.post('/api/client/auto-clan-group', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { region, clan_id } = req.body as { region?: string; clan_id?: string };
    const wantsStream =
      req.query.stream === '1' ||
      String(req.headers.accept || '').includes('text/event-stream');

    const cleanRegion = (region || '').trim();
    const cleanClanId = (clan_id || '').trim();
    if (!cleanRegion) {
      res.status(400).json({ error: 'Region is required.' });
      return;
    }
    if (!cleanClanId || !/^[a-zA-Z0-9_-]{3,40}$/.test(cleanClanId)) {
      res.status(400).json({ error: 'Valid Clan ID is required (3-40 alphanumeric characters).' });
      return;
    }

    const pricing = await getLivePricing(state);
    const regionObj = pricing.regions.find(
      (r) =>
        r.id.toLowerCase() === cleanRegion.toLowerCase() ||
        r.region_code.toLowerCase() === cleanRegion.toLowerCase()
    );
    if (!regionObj || !regionObj.enabled) {
      res.status(400).json({ error: 'Selected region is unavailable or disabled.' });
      return;
    }

    const tier = regionObj.tier === 'premium' ? 'premium' : 'basic';
    if (tier === 'premium' && user.premiumCredits < 1) {
      res.status(402).json({
        error: 'Insufficient premium credits',
        basic_credits: user.basicCredits,
        premium_credits: user.premiumCredits,
        basic_credit_usd: pricing.basic_credit_usd,
        premium_credit_usd: pricing.premium_credit_usd,
      });
      return;
    }
    if (tier === 'basic' && user.basicCredits < 1) {
      res.status(402).json({
        error: 'Insufficient basic credits',
        basic_credits: user.basicCredits,
        premium_credits: user.premiumCredits,
        basic_credit_usd: pricing.basic_credit_usd,
        premium_credit_usd: pricing.premium_credit_usd,
      });
      return;
    }

    const activeCount = state.groups.filter(
      (g) => g.userId === user.id && g.status === 'running' && !g.archived
    ).length;
    if (activeCount >= user.maxGroups) {
      res.status(403).json({ error: `Maximum active groups limit reached (${user.maxGroups}).` });
      return;
    }

    if (activeLaunches.has(user.id)) {
      res.status(409).json({ error: 'Another operation is in progress for this account.' });
      return;
    }
    activeLaunches.add(user.id);

    try {
      if (wantsStream) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
      }

      const sendSse = (event: string, payload: Record<string, unknown>) => {
        if (!wantsStream || res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      sendSse('start', { region: regionObj.region_name, clan_id: cleanClanId, requested: 4 });

      let sawProgress = false;
      // Send real order to connected main provider account (handles SSE & JSON upstream responses)
      const upstream = await streamUpstreamAutoClanGroup(
        state,
        { region: regionObj.id, clan_id: cleanClanId },
        (evt) => {
          if (evt.event === 'progress' || evt.event === 'start') {
            sawProgress = true;
            sendSse(evt.event, evt.data);
          }
        }
      );

      let launchedGroupId = upstream.data?.group_id ? String(upstream.data.group_id) : '';
      let launchedBotCount = Number(upstream.data?.bot_count || 4);

      // If stream ended abnormally after starting on upstream, check upstream /api/client/my-groups to recover the created group
      if ((!upstream.ok || !launchedGroupId) && (sawProgress || upstream.status === 200)) {
        const probe = await callUpstreamApi<
          Array<{ group_id: string; clan_id: string; container_count?: number; created_at?: string }>
        >(state, { method: 'GET', path: '/api/client/my-groups' });
        if (probe.ok && Array.isArray(probe.data)) {
          const recovered = probe.data.find(
            (ug) =>
              ug.clan_id === cleanClanId &&
              !state.groups.some((g) => g.group_id === ug.group_id) &&
              Date.now() - Date.parse(ug.created_at || '') < 120_000
          );
          if (recovered) {
            launchedGroupId = recovered.group_id;
            launchedBotCount = Number(recovered.container_count || 4);
          }
        }
      }

      if (!launchedGroupId) {
        // Provider rejected before launching any group -> do NOT touch credits and do NOT emit a refund transaction
        const rawErr = upstream.error || 'Provider rejected group launch.';
        const safeErr = rawErr.toLowerCase().includes('credit')
          ? `${rawErr} (Provider account balance is empty — your website credit was NOT deducted.)`
          : `${rawErr} (Your website credit was NOT deducted.)`;
        if (wantsStream) {
          sendSse('error', { error: safeErr });
          res.end();
        } else {
          res.status(upstream.status || 502).json({
            error: safeErr,
          });
        }
        return;
      }

      // Group launched on upstream -> permanently deduct 1 website credit (NO auto-refund)
      if (tier === 'premium') {
        user.premiumCredits = Math.max(0, user.premiumCredits - 1);
      } else {
        user.basicCredits = Math.max(0, user.basicCredits - 1);
      }
      user.updatedAt = new Date().toISOString();

      const now = new Date().toISOString();
      const newGroup: GroupRecord = {
        group_id: launchedGroupId,
        userId: user.id,
        username: user.username,
        clan_id: cleanClanId,
        region: regionObj.region_code,
        region_name: regionObj.region_name,
        tier,
        status: 'running',
        container_count: launchedBotCount,
        running_count: launchedBotCount,
        glory_farmed: 0,
        uptime: '0s',
        games_played: 0,
        archived: false,
        created_at: now,
        updated_at: now,
      };

      // Immediately enrich with Clan Board & Glory info from provider
      await enrichGroupWithGloryAndClan(state, newGroup);
      upsertGroup(state, newGroup);

      const clanName = newGroup.clan_info?.decoded?.clan_name;
      addTransaction(state, {
        userId: user.id,
        username: user.username,
        type: 'deduction',
        basic_credits: tier === 'basic' ? -1 : 0,
        premium_credits: tier === 'premium' ? -1 : 0,
        status: 'completed',
        details: `Launched Group #${newGroup.group_id} for ${clanName ? `${clanName} (` : 'Clan '}${cleanClanId}${clanName ? ')' : ''} · ${regionObj.region_name}`,
      });

      addActivityLog(state, {
        userId: user.id,
        username: user.username,
        group_id: newGroup.group_id,
        clan_id: cleanClanId,
        clan_name: clanName,
        region: regionObj.region_name,
        glory_farmed: newGroup.glory_farmed,
        action: 'start',
        details: `Used 1 ${tier} credit. Region: ${regionObj.region_name}. Bots: ${newGroup.container_count}.`,
      });

      await persistState(state);

      const responsePayload = {
        success: true,
        group_id: newGroup.group_id,
        bot_count: newGroup.container_count,
        group: newGroup,
        balance: {
          basic_credits: user.basicCredits,
          premium_credits: user.premiumCredits,
        },
      };

      if (wantsStream) {
        sendSse('done', responsePayload);
        res.end();
      } else {
        res.json(responsePayload);
      }
    } finally {
      activeLaunches.delete(user.id);
    }
  });

  app.get('/api/client/my-groups', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const forceSync = req.query.refresh === '1';

    if (hasUpstreamCredentials(state)) {
      const [upstreamGroups, upstreamHistory] = await Promise.all([
        callUpstreamApi<
          Array<{
            group_id: string;
            clan_id: string;
            region: string;
            status: string;
            container_count: number;
            running_count: number;
            created_at: string;
            uptime: string;
            last_match_at?: string;
            games_played?: number;
            can_extend?: boolean;
            can_replace?: boolean;
            extend_count?: number;
            replace_count?: number;
            max_extends?: number;
            max_replaces?: number;
            extend_price?: number;
            squad_file_enabled?: boolean;
            run_segments?: Array<{
              started_at: string;
              start_glory: number;
              end_glory: number;
              glory_farmed: number;
            }>;
          }>
        >(state, {
          method: 'GET',
          path: '/api/client/my-groups',
        }),
        callUpstreamApi<
          Array<{
            group_id: string;
            clan_id: string;
            username?: string;
            region: string;
            status: string;
            glory_farmed?: number;
            bot_count?: number;
            launched_at?: string;
            glory_snapshots?: Array<{ captured_at: string; total_glory: number; uptime_hours: number }>;
            clan_data?: {
              clan_name?: string;
              clan_level?: number;
              member_num?: number;
              capacity?: number;
              captain_id?: string | number;
              region?: string;
              slogan?: string;
            };
          }>
        >(state, {
          method: 'GET',
          path: '/api/client/group-history',
        }),
      ]);

      const historyMap = new Map<string, NonNullable<typeof upstreamHistory.data>[number]>();
      if (upstreamHistory.ok && Array.isArray(upstreamHistory.data)) {
        for (const h of upstreamHistory.data) {
          historyMap.set(h.group_id, h);
        }
      }

      const regularUsersCount = state.users.filter((u) => u.role === 'user').length;
      const isSingleTenant = regularUsersCount <= 1;

      if (upstreamGroups.ok && Array.isArray(upstreamGroups.data)) {
        const activeIdsOnUpstream = new Set(upstreamGroups.data.map((u) => u.group_id));

        for (const ug of upstreamGroups.data) {
          let existing = state.groups.find((g) => g.group_id === ug.group_id);
          const h = historyMap.get(ug.group_id);

          // Reclaim unassigned upstream groups (or recover active provider groups in single-tenant mode)
          if (!existing || existing.userId === 'provider_account') {
            const ugTime = Date.parse(ug.created_at || '');
            const hasMatchingAttempt = state.transactions.some((t) => {
              if (t.userId !== user.id || !t.details.includes(ug.clan_id)) return false;
              const tTime = Date.parse(t.created_at);
              return !Number.isNaN(ugTime) && !Number.isNaN(tTime) && Math.abs(tTime - ugTime) <= 300_000;
            });
            const matchesUsername = Boolean(h?.username && h.username.toLowerCase() === user.username.toLowerCase());

            if (hasMatchingAttempt || matchesUsername || isSingleTenant) {
              const regionObj = pricingCacheRegionFallback(ug.region);
              existing = {
                ...(existing || {}),
                group_id: ug.group_id,
                userId: user.id,
                username: user.username,
                clan_id: ug.clan_id,
                region: ug.region || 'IND',
                region_name: existing?.region_name || regionObj,
                tier: existing?.tier || (String(ug.region).toUpperCase() === 'ME' ? 'premium' : 'basic'),
                status: (ug.status as GroupRecord['status']) || 'running',
                container_count: ug.container_count || 4,
                running_count: ug.running_count ?? ug.container_count ?? 4,
                glory_farmed: existing?.glory_farmed ?? Number(h?.glory_farmed || 0),
                uptime: ug.uptime || '0s',
                archived: existing?.archived ?? false,
                created_at: ug.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              upsertGroup(state, existing);
              if (!state.activityLogs.some((l) => l.group_id === ug.group_id && l.userId === user.id)) {
                addActivityLog(state, {
                  userId: user.id,
                  username: user.username,
                  group_id: ug.group_id,
                  clan_id: ug.clan_id,
                  clan_name: h?.clan_data?.clan_name,
                  region: existing.region_name,
                  action: 'start',
                  details: `Group #${ug.group_id} active on Clan ${ug.clan_id}. Bots: ${ug.container_count || 4}.`,
                });
              }
            }
          }

          if (existing && existing.userId === user.id) {
            if (existing.status !== 'refunded') {
              existing.status = (ug.status as GroupRecord['status']) || existing.status;
            }
            existing.container_count = ug.container_count ?? existing.container_count;
            existing.running_count = ug.running_count ?? existing.running_count;
            existing.uptime = ug.uptime || existing.uptime;
            if (ug.last_match_at) existing.last_match_at = ug.last_match_at;
            if (typeof ug.games_played === 'number') existing.games_played = ug.games_played;
            if (typeof ug.can_extend === 'boolean') existing.can_extend = ug.can_extend;
            if (typeof ug.can_replace === 'boolean') existing.can_replace = ug.can_replace;
            if (typeof ug.extend_count === 'number') existing.extend_count = ug.extend_count;
            if (typeof ug.replace_count === 'number') existing.replace_count = ug.replace_count;
            if (typeof ug.max_extends === 'number') existing.max_extends = ug.max_extends;
            if (typeof ug.max_replaces === 'number') existing.max_replaces = ug.max_replaces;
            if (typeof ug.extend_price === 'number') existing.extend_price = ug.extend_price;
            if (typeof ug.squad_file_enabled === 'boolean') {
              existing.squad_file_enabled = ug.squad_file_enabled;
            }
            if (Array.isArray(ug.run_segments)) {
              existing.run_segments = ug.run_segments;
            }

            if (h?.clan_data && !existing.clan_info?.decoded) {
              existing.clan_info = {
                ...(existing.clan_info || {}),
                clan_id: ug.clan_id,
                decoded: {
                  clan_id: ug.clan_id,
                  clan_name: h.clan_data.clan_name,
                  clan_level: h.clan_data.clan_level,
                  member_num: h.clan_data.member_num,
                  capacity: h.clan_data.capacity,
                  captain_id: h.clan_data.captain_id,
                  region: h.clan_data.region,
                  slogan: h.clan_data.slogan,
                },
              };
            }
            existing.updated_at = new Date().toISOString();
          }
        }

        // Sync recent upstream history entries in single-tenant mode so Archive/History are populated
        if (isSingleTenant && upstreamHistory.ok && Array.isArray(upstreamHistory.data)) {
          for (const h of upstreamHistory.data.slice(0, 30)) {
            const exists = state.groups.find((g) => g.group_id === h.group_id);
            const isActuallyActive = activeIdsOnUpstream.has(h.group_id);
            if (!exists) {
              const histStatus: GroupRecord['status'] = isActuallyActive
                ? 'running'
                : h.status === 'deleted'
                  ? 'deleted'
                  : 'stopped';
              const recoveredHist: GroupRecord = {
                group_id: h.group_id,
                userId: user.id,
                username: user.username,
                clan_id: h.clan_id,
                region: h.region || 'IND',
                region_name: pricingCacheRegionFallback(h.region),
                tier: String(h.region).toUpperCase() === 'ME' ? 'premium' : 'basic',
                status: histStatus,
                container_count: h.bot_count || 4,
                running_count: isActuallyActive ? (h.bot_count || 4) : 0,
                glory_farmed: Number(h.glory_farmed || 0),
                uptime: isActuallyActive ? 'active' : 'ended',
                archived: !isActuallyActive,
                created_at: h.launched_at || new Date().toISOString(),
                updated_at: new Date().toISOString(),
                glory_snapshots: Array.isArray(h.glory_snapshots) ? h.glory_snapshots : undefined,
                clan_info: h.clan_data
                  ? {
                      clan_id: h.clan_id,
                      decoded: {
                        clan_id: h.clan_id,
                        clan_name: h.clan_data.clan_name,
                        clan_level: h.clan_data.clan_level,
                        member_num: h.clan_data.member_num,
                        capacity: h.clan_data.capacity,
                        captain_id: h.clan_data.captain_id,
                        region: h.clan_data.region,
                        slogan: h.clan_data.slogan,
                      },
                    }
                  : undefined,
              };
              upsertGroup(state, recoveredHist);
            }
          }
        }

        // Reconcile groups no longer listed in active upstream /my-groups
        for (const g of state.groups) {
          if (g.userId === user.id && g.status === 'running' && !activeIdsOnUpstream.has(g.group_id)) {
            const h = historyMap.get(g.group_id);
            g.status = h?.status === 'deleted' ? 'deleted' : 'stopped';
            g.running_count = 0;
            g.archived = true;
            if (h && typeof h.glory_farmed === 'number' && h.glory_farmed > g.glory_farmed) {
              g.glory_farmed = h.glory_farmed;
            }
          }
        }

        // Auto-enrich active running groups (newest first) with live glory & clan board info
        const runningToSync = state.groups
          .filter((g) => {
            if (g.userId !== user.id || g.status !== 'running' || g.archived) return false;
            if (forceSync || !g.glory_synced_at || !g.clan_info?.decoded) return true;
            return Date.now() - Date.parse(g.glory_synced_at) > 12_000;
          })
          .sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));

        await Promise.all(
          runningToSync.slice(0, 8).map((g) => enrichGroupWithGloryAndClan(state, g))
        );

        await persistState(state);
      }
    }

    const userGroups = state.groups
      .filter((g) => g.userId === user.id)
      .sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));
    res.json(userGroups);
  });

  app.post('/api/client/group-action', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { action, group_id } = req.body as { action?: string; group_id?: string };

    if (!action || !group_id) {
      res.status(400).json({ error: 'Both action and group_id are required.' });
      return;
    }

    const group = state.groups.find((g) => g.group_id === group_id && g.userId === user.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found or does not belong to your account.' });
      return;
    }

    if (action === 'archive' || action === 'unarchive') {
      group.archived = action === 'archive';
      group.updated_at = new Date().toISOString();
      await persistState(state);
      res.json({ success: true, group });
      return;
    }

    if (action === 'extend') {
      if (group.status === 'refunded') {
        res.status(400).json({ error: 'Refunded squads cannot be extended.' });
        return;
      }
      if (group.can_extend === false) {
        res.status(400).json({ error: 'Extend is not available for this squad or region.' });
        return;
      }
      const usedExtends = group.extend_count ?? 0;
      const maxExtends = group.max_extends ?? 1;
      if (usedExtends >= maxExtends) {
        res.status(400).json({ error: `Maximum extends reached (${usedExtends}/${maxExtends}).` });
        return;
      }
      const tier = group.tier === 'premium' ? 'premium' : 'basic';
      if (tier === 'premium' && user.premiumCredits < 1) {
        res.status(402).json({ error: 'Insufficient premium credits to extend (+8h).' });
        return;
      }
      if (tier === 'basic' && user.basicCredits < 1) {
        res.status(402).json({ error: 'Insufficient basic credits to extend (+8h).' });
        return;
      }

      const upstreamExtend = await callUpstreamApi<Record<string, unknown>>(state, {
        method: 'POST',
        path: '/api/client/group-action',
        body: { action: 'extend', group_id },
      });

      if (!upstreamExtend.ok) {
        res.status(upstreamExtend.status || 502).json({
          error: upstreamExtend.error || 'Provider rejected squad extend (+8h).',
        });
        return;
      }

      if (tier === 'premium') {
        user.premiumCredits = Math.max(0, user.premiumCredits - 1);
      } else {
        user.basicCredits = Math.max(0, user.basicCredits - 1);
      }
      const nowIso = new Date().toISOString();
      user.updatedAt = nowIso;

      group.archived = false;
      group.status = 'running';
      group.running_count = group.container_count || 4;
      group.extend_count = usedExtends + 1;
      group.updated_at = nowIso;

      const cName = group.clan_info?.decoded?.clan_name;
      addTransaction(state, {
        userId: user.id,
        username: user.username,
        type: 'deduction',
        basic_credits: tier === 'basic' ? -1 : 0,
        premium_credits: tier === 'premium' ? -1 : 0,
        status: 'completed',
        details: `Extended Squad #${group.group_id} (+8h) for ${cName ? `${cName} (` : 'Clan '}${group.clan_id}${cName ? ')' : ''}`,
      });

      addActivityLog(state, {
        userId: user.id,
        username: user.username,
        group_id: group.group_id,
        clan_id: group.clan_id,
        clan_name: cName,
        region: group.region_name,
        glory_farmed: group.glory_farmed,
        action: 'extend',
        details: `Extended squad +8h using 1 ${tier} credit in ${group.region_name}.`,
      });

      await persistState(state);
      res.json({
        success: true,
        action: 'extend',
        group,
        user: toPublicUser(user),
        upstream: upstreamExtend.data,
      });
      return;
    }

    const allowedUpstreamActions = ['stop', 'restart', 'delete', 'get-glory', 'get-clan-info'];
    if (!allowedUpstreamActions.includes(action)) {
      res.status(400).json({ error: `Unsupported action: ${action}` });
      return;
    }

    const upstream = await callUpstreamApi<Record<string, unknown>>(state, {
      method: 'POST',
      path: '/api/client/group-action',
      body: { action, group_id },
    });

    if (!upstream.ok) {
      res.status(upstream.status || 502).json({
        error: upstream.error || `Provider group action '${action}' failed.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const clanName = group.clan_info?.decoded?.clan_name;
    if (action === 'stop') {
      group.status = 'stopped';
      group.running_count = 0;
      addActivityLog(state, {
        userId: user.id,
        username: user.username,
        group_id: group.group_id,
        clan_id: group.clan_id,
        clan_name: clanName,
        region: group.region_name,
        glory_farmed: group.glory_farmed,
        action: 'stop',
        details: `Stopped group in ${group.region_name}. Uptime: ${group.uptime}. Glory: ${group.glory_farmed}.`,
        runtime_label: group.uptime ? `Recorded runtime · ${group.uptime}` : undefined,
      });
    } else if (action === 'restart') {
      group.status = 'running';
      group.running_count = group.container_count;
      addActivityLog(state, {
        userId: user.id,
        username: user.username,
        group_id: group.group_id,
        clan_id: group.clan_id,
        clan_name: clanName,
        region: group.region_name,
        glory_farmed: group.glory_farmed,
        action: 'restart',
        details: `Restarted group containers in ${group.region_name}.`,
      });
    } else if (action === 'delete') {
      group.status = 'deleted';
      group.archived = true;
      group.running_count = 0;
      addActivityLog(state, {
        userId: user.id,
        username: user.username,
        group_id: group.group_id,
        clan_id: group.clan_id,
        clan_name: clanName,
        region: group.region_name,
        glory_farmed: group.glory_farmed,
        action: 'delete',
        details: `Permanently deleted group #${group.group_id}.`,
      });
    } else if (action === 'get-glory' && upstream.data) {
      const gloryVal = Number(
        upstream.data.total_glory ?? upstream.data.glory ?? upstream.data.glory_farmed ?? group.glory_farmed
      );
      if (!Number.isNaN(gloryVal)) {
        group.glory_farmed = gloryVal;
        const snapshots = Array.isArray(group.glory_snapshots) ? group.glory_snapshots : [];
        const lastSnap = snapshots[snapshots.length - 1];
        if (!lastSnap || lastSnap.total_glory !== gloryVal) {
          snapshots.push({
            captured_at: now,
            total_glory: gloryVal,
            uptime_hours: Math.max(0, Number(((Date.now() - Date.parse(group.created_at || now)) / 3_600_000).toFixed(2))),
          });
          group.glory_snapshots = snapshots.slice(-50);
        }
      }
      if (Array.isArray(upstream.data.details)) {
        group.glory_details = upstream.data.details as GroupBotDetail[];
      }
      if (typeof upstream.data.can_extend === 'boolean') group.can_extend = upstream.data.can_extend;
      if (typeof upstream.data.can_replace === 'boolean') group.can_replace = upstream.data.can_replace;
      if (typeof upstream.data.extend_count === 'number') group.extend_count = upstream.data.extend_count;
      if (typeof upstream.data.replace_count === 'number') group.replace_count = upstream.data.replace_count;
      if (typeof upstream.data.max_extends === 'number') group.max_extends = upstream.data.max_extends;
      if (typeof upstream.data.max_replaces === 'number') group.max_replaces = upstream.data.max_replaces;
      if (typeof upstream.data.extend_price === 'number') group.extend_price = upstream.data.extend_price;
      group.glory_synced_at = now;
    } else if (action === 'get-clan-info' && upstream.data) {
      group.clan_info = upstream.data as ClanInfoPayload;
    }

    group.updated_at = now;
    await persistState(state);

    res.json({
      success: true,
      action,
      group,
      upstream: upstream.data,
    });
  });

  // ==========================================
  // COUPONS
  // ==========================================

  app.get('/api/client/my-coupons', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const list = state.coupons.filter((c) => c.created_by_uid === user.id);
    res.json(list);
  });

  app.get('/api/client/redeemed-coupons', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const list = state.coupons.filter((c) => c.redeemed_by.some((r) => r.uid === user.id));
    res.json(list);
  });

  app.post('/api/client/create-coupon', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { basic_credits, premium_credits } = req.body as {
      basic_credits?: number;
      premium_credits?: number;
    };

    const basic = Math.max(0, Math.floor(Number(basic_credits) || 0));
    const premium = Math.max(0, Math.floor(Number(premium_credits) || 0));

    if (basic > 100) {
      res.status(400).json({ error: 'Basic credits per coupon cannot exceed 100.' });
      return;
    }
    if (premium > 20) {
      res.status(400).json({ error: 'Premium credits per coupon cannot exceed 20.' });
      return;
    }
    if (basic + premium < 1) {
      res.status(400).json({ error: 'At least 1 credit total is required.' });
      return;
    }
    if (user.basicCredits < basic || user.premiumCredits < premium) {
      res.status(402).json({ error: 'Insufficient credits to create this coupon.' });
      return;
    }

    const activeOwned = state.coupons.filter(
      (c) => c.created_by_uid === user.id && c.status === 'active'
    ).length;
    if (activeOwned >= 100) {
      res.status(403).json({ error: 'Maximum 100 active coupons per account reached.' });
      return;
    }

    const code = generateCouponCode();

    user.basicCredits -= basic;
    user.premiumCredits -= premium;
    user.updatedAt = new Date().toISOString();

    const now = new Date().toISOString();
    const coupon = {
      code,
      basic_credits: basic,
      premium_credits: premium,
      status: 'active' as const,
      created_by_uid: user.id,
      created_by: user.username,
      is_admin_issued: false,
      usage_limit: 1,
      used_count: 0,
      redeemed_by: [],
      expires_at: null,
      created_at: now,
      updated_at: now,
    };
    state.coupons.unshift(coupon);

    addTransaction(state, {
      userId: user.id,
      username: user.username,
      type: 'coupon_create',
      basic_credits: -basic,
      premium_credits: -premium,
      status: 'completed',
      details: `Created coupon ${code}`,
    });

    await persistState(state);
    res.json({
      success: true,
      coupon,
      balance: { basic_credits: user.basicCredits, premium_credits: user.premiumCredits },
    });
  });

  app.post('/api/client/redeem-coupon', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;

    const nowMs = Date.now();
    const prev = (redeemAttempts.get(user.id) || []).filter((t) => nowMs - t < 60_000);
    if (prev.length >= 5) {
      res.status(429).json({ error: 'Rate limit exceeded: max 5 coupon attempts per 60 seconds.' });
      return;
    }
    prev.push(nowMs);
    redeemAttempts.set(user.id, prev);

    const { code } = req.body as { code?: string };
    const cleanCode = (code || '').trim().toUpperCase();
    if (!cleanCode) {
      res.status(400).json({ error: 'Please enter a coupon code.' });
      return;
    }

    const coupon = findCoupon(state, cleanCode);
    if (coupon) {
      if (coupon.status !== 'active') {
        res.status(400).json({ error: `Coupon is ${coupon.status} and cannot be redeemed.` });
        return;
      }
      if (coupon.expires_at && new Date(coupon.expires_at).getTime() < nowMs) {
        coupon.status = 'expired';
        coupon.updated_at = new Date().toISOString();
        await persistState(state);
        res.status(400).json({ error: 'This coupon has expired.' });
        return;
      }
      if (coupon.used_count >= coupon.usage_limit) {
        coupon.status = 'redeemed';
        coupon.updated_at = new Date().toISOString();
        await persistState(state);
        res.status(400).json({ error: 'This coupon has reached its usage limit.' });
        return;
      }
      if (coupon.redeemed_by.some((r) => r.uid === user.id)) {
        res.status(409).json({ error: 'You have already redeemed this coupon.' });
        return;
      }

      coupon.used_count += 1;
      coupon.redeemed_by.push({
        uid: user.id,
        username: user.username,
        redeemed_at: new Date().toISOString(),
      });
      if (coupon.used_count >= coupon.usage_limit) {
        coupon.status = 'redeemed';
      }
      coupon.updated_at = new Date().toISOString();

      user.basicCredits += coupon.basic_credits;
      user.premiumCredits += coupon.premium_credits;
      user.updatedAt = new Date().toISOString();

      addTransaction(state, {
        userId: user.id,
        username: user.username,
        type: 'coupon_redeem',
        basic_credits: coupon.basic_credits,
        premium_credits: coupon.premium_credits,
        status: 'completed',
        details: `Redeemed coupon ${coupon.code}`,
      });

      addNotification(state, {
        userId: user.id,
        type: 'success',
        title: 'Coupon Redeemed',
        message: `Added +${coupon.basic_credits} Basic and +${coupon.premium_credits} Premium credits.`,
      });

      await persistState(state);
      res.json({
        success: true,
        code: coupon.code,
        basic_credits: coupon.basic_credits,
        premium_credits: coupon.premium_credits,
        balance: { basic_credits: user.basicCredits, premium_credits: user.premiumCredits },
      });
      return;
    }

    // Forward to provider API if not a local coupon
    if (hasUpstreamCredentials(state)) {
      const upstream = await callUpstreamApi<{
        basic_credits?: number;
        premium_credits?: number;
        error?: string;
      }>(state, {
        method: 'POST',
        path: '/api/client/redeem-coupon',
        body: { code: cleanCode },
      });

      if (!upstream.ok || !upstream.data) {
        res.status(upstream.status || 404).json({
          error: upstream.error || 'Coupon code not found or invalid.',
        });
        return;
      }

      const addBasic = Number(upstream.data.basic_credits || 0);
      const addPrem = Number(upstream.data.premium_credits || 0);
      user.basicCredits += addBasic;
      user.premiumCredits += addPrem;
      user.updatedAt = new Date().toISOString();

      addTransaction(state, {
        userId: user.id,
        username: user.username,
        type: 'coupon_redeem',
        basic_credits: addBasic,
        premium_credits: addPrem,
        status: 'completed',
        details: `Redeemed provider coupon ${cleanCode}`,
      });

      await persistState(state);
      res.json({
        success: true,
        code: cleanCode,
        basic_credits: addBasic,
        premium_credits: addPrem,
        balance: { basic_credits: user.basicCredits, premium_credits: user.premiumCredits },
      });
      return;
    }

    res.status(404).json({ error: 'Coupon code not found or invalid.' });
  });

  app.post('/api/client/cancel-coupon', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { code } = req.body as { code?: string };
    const cleanCode = (code || '').trim().toUpperCase();

    const coupon = findCoupon(state, cleanCode);
    if (!coupon || coupon.created_by_uid !== user.id) {
      res.status(404).json({ error: 'Coupon not found or not owned by you.' });
      return;
    }
    if (coupon.status !== 'active' || coupon.used_count > 0) {
      res.status(400).json({ error: 'Only unused active coupons can be cancelled.' });
      return;
    }

    coupon.status = 'cancelled';
    coupon.updated_at = new Date().toISOString();
    user.basicCredits += coupon.basic_credits;
    user.premiumCredits += coupon.premium_credits;
    user.updatedAt = new Date().toISOString();

    addTransaction(state, {
      userId: user.id,
      username: user.username,
      type: 'coupon_cancel',
      basic_credits: coupon.basic_credits,
      premium_credits: coupon.premium_credits,
      status: 'completed',
      details: `Cancelled coupon ${coupon.code} and refunded credits`,
    });

    await persistState(state);
    res.json({
      success: true,
      refunded_basic: coupon.basic_credits,
      refunded_premium: coupon.premium_credits,
      balance: { basic_credits: user.basicCredits, premium_credits: user.premiumCredits },
    });
  });

  // ==========================================
  // TRANSACTIONS, HISTORY & NOTIFICATIONS
  // ==========================================

  app.get('/api/client/transactions', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const localTxns = state.transactions.filter((t) => t.userId === user.id).slice(0, 50);
    res.json(localTxns);
  });

  app.post('/api/client/cancel-transaction', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const { transaction_id } = req.body as { transaction_id?: string };

    const txn = state.transactions.find((t) => t.id === transaction_id && t.userId === user.id);
    if (!txn) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }
    if (txn.status !== 'pending') {
      res.status(400).json({ error: 'Only pending transactions can be cancelled.' });
      return;
    }

    txn.status = 'cancelled';
    txn.updated_at = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, message: 'Pending transaction cancelled.' });
  });

  app.get('/api/client/group-history', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const userGroups = state.groups.filter((g) => g.userId === user.id);
    const userGroupIds = new Set(userGroups.map((g) => g.group_id));
    const clanNameById = new Map<string, string>();
    const gloryByGroupId = new Map<string, number>();

    for (const g of userGroups) {
      if (g.clan_info?.decoded?.clan_name) {
        clanNameById.set(g.clan_id, g.clan_info.decoded.clan_name);
      }
      gloryByGroupId.set(g.group_id, g.glory_farmed);
    }

    if (hasUpstreamCredentials(state) && userGroupIds.size > 0) {
      const [upHist, upAct] = await Promise.all([
        callUpstreamApi<
          Array<{
            group_id: string;
            clan_id: string;
            status?: string;
            glory_farmed?: number;
            glory_snapshots?: Array<{ captured_at: string; total_glory: number; uptime_hours: number }>;
            clan_data?: {
              clan_name?: string;
              clan_level?: number;
              member_num?: number;
              capacity?: number;
              captain_id?: string | number;
              region?: string;
              slogan?: string;
            };
          }>
        >(state, { method: 'GET', path: '/api/client/group-history' }),
        callUpstreamApi<
          Array<{
            id: string;
            action: string;
            group_id?: string;
            clan_id?: string;
            details?: string;
            timestamp: string;
          }>
        >(state, { method: 'GET', path: '/api/client/activity-log' }),
      ]);

      if (upHist.ok && Array.isArray(upHist.data)) {
        for (const h of upHist.data) {
          const g = userGroups.find((ug) => ug.group_id === h.group_id);
          if (!g) continue;
          if (h.clan_data?.clan_name) clanNameById.set(g.clan_id, h.clan_data.clan_name);
          if (typeof h.glory_farmed === 'number' && h.glory_farmed > g.glory_farmed) {
            g.glory_farmed = h.glory_farmed;
            gloryByGroupId.set(g.group_id, h.glory_farmed);
          }
          if (Array.isArray(h.glory_snapshots) && h.glory_snapshots.length > (g.glory_snapshots?.length || 0)) {
            g.glory_snapshots = h.glory_snapshots;
          }
          if (h.clan_data && !g.clan_info?.decoded) {
            g.clan_info = {
              ...(g.clan_info || {}),
              clan_id: g.clan_id,
              decoded: {
                clan_id: g.clan_id,
                clan_name: h.clan_data.clan_name,
                clan_level: h.clan_data.clan_level,
                member_num: h.clan_data.member_num,
                capacity: h.clan_data.capacity,
                captain_id: h.clan_data.captain_id,
                region: h.clan_data.region,
                slogan: h.clan_data.slogan,
              },
            };
          }
        }
      }

      if (upAct.ok && Array.isArray(upAct.data)) {
        for (const item of upAct.data) {
          if (!item.group_id || !userGroupIds.has(item.group_id)) continue;
          const exists = state.activityLogs.some(
            (l) => l.id === `up_${item.id}` || (l.group_id === item.group_id && l.action === item.action && Math.abs(Date.parse(l.timestamp) - Date.parse(item.timestamp)) < 10_000)
          );
          if (!exists) {
            state.activityLogs.push({
              id: `up_${item.id}`,
              userId: user.id,
              username: user.username,
              group_id: item.group_id,
              clan_id: item.clan_id,
              clan_name: item.clan_id ? clanNameById.get(item.clan_id) : undefined,
              glory_farmed: gloryByGroupId.get(item.group_id),
              action: (item.action as ActivityLogRecord['action']) || 'start',
              details: item.details || '',
              timestamp: item.timestamp,
            });
          }
        }
      }
    }

    const logs = state.activityLogs
      .filter((l) => l.userId === user.id)
      .map((l) => ({
        ...l,
        clan_name: l.clan_name || (l.clan_id ? clanNameById.get(l.clan_id) : undefined),
        glory_farmed: l.glory_farmed ?? (l.group_id ? gloryByGroupId.get(l.group_id) : undefined),
      }))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 200);

    res.json({ logs, groups: userGroups });
  });

  app.get('/api/client/glory-progression', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const groupId = String(req.query.group_id || '').trim();
    if (!groupId) {
      res.status(400).json({ error: 'group_id query parameter is required.' });
      return;
    }

    const group = state.groups.find((g) => g.group_id === groupId && g.userId === user.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    if (hasUpstreamCredentials(state)) {
      const upstream = await callUpstreamApi<{
        clan_id?: string;
        glory_farmed?: number;
        snapshots?: Array<{ captured_at: string; total_glory: number }>;
      } | null>(state, {
        method: 'GET',
        path: `/api/client/glory-progression?group_id=${encodeURIComponent(groupId)}`,
      });
      if (upstream.ok && upstream.data && Array.isArray(upstream.data.snapshots) && upstream.data.snapshots.length > 0) {
        res.json({
          ...upstream.data,
          clan_id: upstream.data.clan_id || group.clan_id,
          clan_name: group.clan_info?.decoded?.clan_name,
          glory_farmed: Math.max(group.glory_farmed, Number(upstream.data.glory_farmed || 0)),
          games_played: group.games_played ?? 0,
          glory_details: group.glory_details || [],
          run_segments: group.run_segments || [],
        });
        return;
      }
    }

    const fallbackSnapshots =
      group.glory_snapshots && group.glory_snapshots.length > 0
        ? group.glory_snapshots
        : group.glory_farmed > 0
          ? [{ captured_at: group.glory_synced_at || group.updated_at, total_glory: group.glory_farmed, uptime_hours: 0 }]
          : [];

    res.json({
      clan_id: group.clan_id,
      clan_name: group.clan_info?.decoded?.clan_name,
      glory_farmed: group.glory_farmed,
      games_played: group.games_played ?? 0,
      snapshots: fallbackSnapshots,
      glory_details: group.glory_details || [],
      run_segments: group.run_segments || [],
    });
  });

  app.get('/api/client/activity-log', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    const userGroups = state.groups.filter((g) => g.userId === user.id);
    const clanNameById = new Map<string, string>();
    for (const g of userGroups) {
      if (g.clan_info?.decoded?.clan_name) {
        clanNameById.set(g.clan_id, g.clan_info.decoded.clan_name);
      }
    }
    const logs = state.activityLogs
      .filter((l) => l.userId === user.id)
      .map((l) => ({
        ...l,
        clan_name: l.clan_name || (l.clan_id ? clanNameById.get(l.clan_id) : undefined),
      }))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 200);
    res.json(logs);
  });

  app.get('/api/client/notifications', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;

    if (state.settings.websiteNotificationsEnabled && hasUpstreamCredentials(state)) {
      const upstream = await callUpstreamApi<
        Array<{ type?: string; title?: string; message?: string }>
      >(state, {
        method: 'GET',
        path: '/api/client/notifications',
      });
      if (upstream.ok && Array.isArray(upstream.data) && upstream.data.length > 0) {
        for (const n of upstream.data) {
          addNotification(state, {
            userId: user.id,
            type: (n.type as 'info' | 'success' | 'warning' | 'error') || 'info',
            title: n.title || 'Panel Notification',
            message: n.message || '',
          });
        }
        await persistState(state);
      }
    }

    res.json(state.notifications.filter((n) => n.userId === user.id).slice(0, 50));
  });

  app.post('/api/client/notifications/read', requireUser, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = req.authUser!;
    for (const n of state.notifications) {
      if (n.userId === user.id) n.read = true;
    }
    await persistState(state);
    res.json({ success: true });
  });

  // ==========================================
  // ADMIN AUTHENTICATION & INITIAL SETUP
  // ==========================================

  app.get('/api/admin/setup-status', async (_req, res) => {
    const state = await loadState();
    const admin = state.users.find((u) => u.role === 'admin');
    res.json({
      setupRequired: Boolean(state.adminSetupRequired || !admin?.passwordHash),
    });
  });

  app.post('/api/admin/setup', async (req, res) => {
    const state = await loadState();
    const admin = state.users.find((u) => u.role === 'admin');
    if (!admin) {
      res.status(500).json({ error: 'Super Admin record missing.' });
      return;
    }
    if (!state.adminSetupRequired && admin.passwordHash) {
      res.status(403).json({ error: 'Super Admin is already initialized. Please sign in.' });
      return;
    }

    const { password, confirmPassword } = req.body as {
      password?: string;
      confirmPassword?: string;
    };
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Admin access key must be at least 8 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Keys do not match.' });
      return;
    }

    admin.passwordHash = hashPassword(password);
    admin.updatedAt = new Date().toISOString();
    state.adminSetupRequired = false;
    await persistState(state);

    const token = createSessionToken(
      { uid: admin.id, username: admin.username, role: 'admin', scope: 'admin' },
      state.sessionSecret
    );
    setAuthCookie(res, ADMIN_COOKIE, token, req);
    res.json({ token, admin: toPublicUser(admin) });
  });

  app.post('/api/admin/login', async (req, res) => {
    const state = await loadState();
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      username?: string;
      password?: string;
      accessKey?: string;
    };
    const identifier = String(body.username || '').trim().toLowerCase();
    const secretKey = String(body.accessKey ?? body.password ?? '');
    const trimmedKey = secretKey.trim();

    if (!trimmedKey) {
      res.status(400).json({ error: 'Admin access key is required.' });
      return;
    }

    const adminCandidates = state.users.filter((u) => {
      if (u.role !== 'admin') return false;
      if (!identifier) return true;
      return (
        u.username.toLowerCase() === identifier ||
        u.email.toLowerCase() === identifier
      );
    });

    const matchesAdminKey = (hash: string | undefined): boolean => {
      if (!hash) return false;
      if (verifyPassword(secretKey, hash)) return true;
      if (trimmedKey !== secretKey && verifyPassword(trimmedKey, hash)) return true;
      return false;
    };

    let admin = adminCandidates.find((u) => matchesAdminKey(u.passwordHash));
    if (!admin && identifier) {
      // If an outdated username was autofilled by the browser password manager, still accept valid key match
      admin = state.users.find((u) => u.role === 'admin' && matchesAdminKey(u.passwordHash));
    }
    if (!admin) {
      res.status(401).json({ error: 'Invalid admin access key.' });
      return;
    }

    const token = createSessionToken(
      { uid: admin.id, username: admin.username, role: 'admin', scope: 'admin' },
      state.sessionSecret
    );
    setAuthCookie(res, ADMIN_COOKIE, token, req);
    res.json({ token, admin: toPublicUser(admin) });
  });

  app.post('/api/admin/google-login', async (req, res) => {
    const state = await loadState();
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      res.status(400).json({ error: 'Missing Google ID token.' });
      return;
    }

    const verified = await verifyGoogleIdToken(idToken, getGoogleClientId());
    if (!verified) {
      res.status(401).json({ error: 'Invalid or unverified Google token.' });
      return;
    }

    const envAllowed = [
      process.env.ADMIN_EMAIL || '',
      ...(process.env.ADMIN_ALLOWED_EMAILS || '').split(','),
    ]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const admin = state.users.find(
      (u) =>
        u.role === 'admin' &&
        (u.email.toLowerCase() === verified.email ||
          verified.email === 'kaakru2@gmail.com' ||
          verified.email === 'ffharsh813@gmail.com' ||
          envAllowed.includes(verified.email))
    );
    if (!admin) {
      res.status(403).json({
        error: `Forbidden: "${verified.email}" is not an authorized Super Admin email. Unlock with your Admin Access Key or set ADMIN_EMAIL.`,
      });
      return;
    }

    const token = createSessionToken(
      { uid: admin.id, username: admin.username, role: 'admin', scope: 'admin' },
      state.sessionSecret
    );
    setAuthCookie(res, ADMIN_COOKIE, token, req);
    res.json({ token, admin: toPublicUser(admin) });
  });

  app.post('/api/admin/logout', (req, res) => {
    clearAuthCookie(res, ADMIN_COOKIE, req);
    res.json({ success: true });
  });

  app.get('/api/admin/me', requireAdmin, (req: AuthedRequest, res) => {
    res.json({ admin: toPublicUser(req.authUser!) });
  });

  app.post('/api/admin/change-password', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const { currentPassword, newPassword, confirmNewPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
      confirmNewPassword?: string;
    };
    if (admin.passwordHash && (!currentPassword || !verifyPassword(currentPassword, admin.passwordHash))) {
      res.status(400).json({ error: 'Current admin access key is incorrect.' });
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'New admin access key must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      res.status(400).json({ error: 'Access keys do not match.' });
      return;
    }
    admin.passwordHash = hashPassword(newPassword);
    admin.updatedAt = new Date().toISOString();
    state.adminSetupRequired = false;
    const envKey = (process.env.ADMIN_ACCESS_KEY || process.env.ADMIN_PASSWORD || '').trim();
    if (envKey) {
      state.adminEnvKeyFingerprint = crypto.createHash('sha256').update(envKey).digest('hex');
    }
    await persistState(state);
    res.json({ success: true, message: 'Admin access key updated.' });
  });

  // ==========================================
  // ADMIN PANEL MANAGEMENT ENDPOINTS
  // ==========================================

  app.get('/api/admin/overview', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const normalUsers = state.users.filter((u) => u.role !== 'admin');
    const activeUsers = normalUsers.filter((u) => !u.blocked).length;
    const totalBasicCredits = normalUsers.reduce((acc, u) => acc + u.basicCredits, 0);
    const totalPremiumCredits = normalUsers.reduce((acc, u) => acc + u.premiumCredits, 0);
    const activeGroups = state.groups.filter((g) => g.status === 'running' && !g.archived).length;
    const providerAccount = await getProviderAccountSummary(state);

    res.json({
      totalUsers: normalUsers.length,
      activeUsers,
      totalCredits: totalBasicCredits + totalPremiumCredits,
      basicCredits: totalBasicCredits,
      premiumCredits: totalPremiumCredits,
      totalTransactions: state.transactions.length,
      activeGroups,
      totalGroups: state.groups.length,
      providerAccount,
      deploymentStatus: getDeploymentStatus(state),
      apiStatus: {
        configured: hasUpstreamCredentials(state),
        status: state.apiConfig.lastStatus || 'unconfigured',
        lastTestedAt: state.apiConfig.lastTestedAt || null,
        lastMessage: state.apiConfig.lastMessage || '',
      },
    });
  });

  app.get('/api/admin/users', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const q = String(req.query.q || '').trim().toLowerCase();
    const list = state.users
      .filter((u) => u.role !== 'admin')
      .filter(
        (u) =>
          !q ||
          u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q)
      )
      .map(toPublicUser);
    res.json(list);
  });

  app.get('/api/admin/users/:id', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = state.users.find((u) => u.id === req.params.id && u.role !== 'admin');
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const transactions = state.transactions.filter((t) => t.userId === user.id);
    const groups = state.groups.filter((g) => g.userId === user.id);
    const audits = state.creditAudits.filter((a) => a.targetUserId === user.id);
    res.json({ user: toPublicUser(user), transactions, groups, audits });
  });

  app.post('/api/admin/users/:id/block', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = state.users.find((u) => u.id === req.params.id && u.role !== 'admin');
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    user.blocked = true;
    user.updatedAt = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, user: toPublicUser(user) });
  });

  app.post('/api/admin/users/:id/unblock', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const user = state.users.find((u) => u.id === req.params.id && u.role !== 'admin');
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    user.blocked = false;
    user.updatedAt = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, user: toPublicUser(user) });
  });

  app.post('/api/admin/users/:id/credits', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const user = state.users.find((u) => u.id === req.params.id && u.role !== 'admin');
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const { operation, creditType, amount, reason, operationId } = req.body as {
      operation?: 'add' | 'deduct' | 'set';
      creditType?: 'basic' | 'premium';
      amount?: number;
      reason?: string;
      operationId?: string;
    };

    // Idempotency guard against duplicate credit adjustments
    if (operationId && state.processedOperationIds.includes(operationId)) {
      res.status(409).json({ error: 'Duplicate credit operation detected and prevented.' });
      return;
    }

    const qty = Math.floor(Number(amount));
    if (Number.isNaN(qty) || (operation === 'set' ? qty < 0 : qty <= 0)) {
      res.status(400).json({
        error:
          operation === 'set'
            ? 'Target credit balance must be 0 or greater.'
            : 'Credit amount must be a positive integer.',
      });
      return;
    }
    if (operation !== 'add' && operation !== 'deduct' && operation !== 'set') {
      res.status(400).json({ error: 'Operation must be add, deduct, or set.' });
      return;
    }
    if (creditType !== 'basic' && creditType !== 'premium') {
      res.status(400).json({ error: 'Credit type must be basic or premium.' });
      return;
    }

    const previousBalance = creditType === 'basic' ? user.basicCredits : user.premiumCredits;
    let newBalance = previousBalance;
    if (operation === 'add') {
      newBalance = previousBalance + qty;
    } else if (operation === 'deduct') {
      if (previousBalance < qty) {
        res.status(400).json({ error: `Insufficient user ${creditType} credits to deduct.` });
        return;
      }
      newBalance = previousBalance - qty;
    } else {
      newBalance = qty;
    }

    const delta = newBalance - previousBalance;
    if (creditType === 'basic') {
      user.basicCredits = newBalance;
    } else {
      user.premiumCredits = newBalance;
    }
    user.updatedAt = new Date().toISOString();

    const txnType =
      operation === 'add' ? 'admin_add' : operation === 'deduct' ? 'admin_deduct' : 'admin_set';
    const cleanReason = reason ? String(reason).trim().slice(0, 200) : '';
    const detailText = cleanReason
      ? `Admin (${admin.username}) ${operation} ${qty} ${creditType}: ${cleanReason} [${previousBalance} → ${newBalance}]`
      : `Admin (${admin.username}) ${operation} ${qty} ${creditType} credit(s) [${previousBalance} → ${newBalance}]`;

    const txn = addTransaction(state, {
      userId: user.id,
      username: user.username,
      type: txnType,
      basic_credits: creditType === 'basic' ? delta : 0,
      premium_credits: creditType === 'premium' ? delta : 0,
      status: 'completed',
      details: detailText,
      performed_by: admin.username,
    });

    const audit = addCreditAudit(state, {
      operationId: operationId || `op_${crypto.randomBytes(6).toString('hex')}`,
      adminId: admin.id,
      adminUsername: admin.username,
      targetUserId: user.id,
      targetUsername: user.username,
      operation,
      creditType,
      amount: qty,
      previousBalance,
      newBalance,
      reason: cleanReason || `${operation} ${qty} ${creditType}`,
    });

    addActivityLog(state, {
      userId: user.id,
      username: user.username,
      action: operation === 'add' ? 'credit_add' : operation === 'deduct' ? 'credit_deduct' : 'credit_set',
      details: detailText,
    });

    addNotification(state, {
      userId: user.id,
      type: delta >= 0 ? 'success' : 'warning',
      title: 'Credit Balance Updated',
      message: `${delta >= 0 ? `+${delta}` : delta} ${creditType} credit(s). New balance: ${newBalance}.`,
    });

    await persistState(state);
    res.json({ success: true, user: toPublicUser(user), transaction: txn, audit });
  });

  app.get('/api/admin/credit-audits', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    res.json(state.creditAudits.slice(0, 500));
  });

  app.get('/api/admin/groups', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    // Also fetch live provider groups so admin sees connected provider state
    if (hasUpstreamCredentials(state)) {
      const upstream = await callUpstreamApi<
        Array<{
          group_id: string;
          clan_id: string;
          region: string;
          status: string;
          container_count: number;
          running_count: number;
          created_at: string;
          uptime: string;
          games_played?: number;
        }>
      >(state, {
        method: 'GET',
        path: '/api/client/my-groups',
      });
      if (upstream.ok && Array.isArray(upstream.data)) {
        const regularUsers = state.users.filter((u) => u.role === 'user');
        const defaultOwner = regularUsers.length === 1 ? regularUsers[0] : null;
        const activeIdsOnUpstream = new Set(upstream.data.map((u) => String(u.group_id)));
        for (const ug of upstream.data) {
          const existing = state.groups.find((g) => g.group_id === ug.group_id);
          if (existing) {
            if (existing.status !== 'refunded') {
              existing.status = (ug.status as GroupRecord['status']) || existing.status;
            }
            existing.container_count = ug.container_count ?? existing.container_count;
            existing.running_count = ug.running_count ?? existing.running_count;
            existing.uptime = ug.uptime || existing.uptime;
            if (typeof ug.games_played === 'number') existing.games_played = ug.games_played;
            existing.updated_at = new Date().toISOString();
          } else {
            state.groups.unshift({
              group_id: String(ug.group_id),
              userId: defaultOwner ? defaultOwner.id : 'provider_account',
              username: defaultOwner ? defaultOwner.username : (state.apiConfig.providerUsername || 'provider'),
              clan_id: String(ug.clan_id || ''),
              region: String(ug.region || ''),
              region_name: pricingCacheRegionFallback(String(ug.region || '')),
              tier: String(ug.region).toUpperCase() === 'ME' ? 'premium' : 'basic',
              status: (ug.status as GroupRecord['status']) || 'running',
              container_count: Number(ug.container_count || 0),
              running_count: Number(ug.running_count || 0),
              glory_farmed: 0,
              uptime: String(ug.uptime || ''),
              games_played: ug.games_played,
              archived: false,
              created_at: ug.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        }
        for (const g of state.groups) {
          if (g.status === 'running' && !activeIdsOnUpstream.has(g.group_id)) {
            g.status = 'stopped';
            g.running_count = 0;
            g.archived = true;
          }
        }
        const runningToSync = state.groups
          .filter((g) => g.status === 'running')
          .sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))
          .slice(0, 8);
        await Promise.all(runningToSync.map((g) => enrichGroupWithGloryAndClan(state, g)));
        await persistState(state);
      }
    }
    res.json(
      [...state.groups].sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))
    );
  });

  app.post('/api/admin/groups/:id/action', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const { action } = req.body as { action?: string };
    const group = state.groups.find((g) => g.group_id === req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }
    if (!action || !['stop', 'restart', 'delete', 'get-glory', 'get-clan-info'].includes(action)) {
      res.status(400).json({ error: 'Action must be stop, restart, delete, get-glory, or get-clan-info.' });
      return;
    }

    if (action === 'get-glory' || action === 'get-clan-info') {
      await enrichGroupWithGloryAndClan(state, group);
      await persistState(state);
      res.json({ success: true, group });
      return;
    }

    const upstream = await callUpstreamApi(state, {
      method: 'POST',
      path: '/api/client/group-action',
      body: { action, group_id: group.group_id },
    });
    if (!upstream.ok) {
      res.status(upstream.status || 502).json({ error: upstream.error || 'Provider action failed.' });
      return;
    }

    group.status = action === 'restart' ? 'running' : action === 'stop' ? 'stopped' : 'deleted';
    if (action === 'delete') group.archived = true;
    if (action === 'stop' || action === 'delete') group.running_count = 0;
    group.updated_at = new Date().toISOString();

    addActivityLog(state, {
      userId: group.userId,
      username: group.username,
      group_id: group.group_id,
      clan_id: group.clan_id,
      clan_name: group.clan_info?.decoded?.clan_name,
      region: group.region_name,
      glory_farmed: group.glory_farmed,
      action: action as 'stop' | 'restart' | 'delete',
      details: `Admin executed '${action}' on group #${group.group_id}.`,
    });

    await persistState(state);
    res.json({ success: true, group });
  });

  app.post('/api/admin/groups/:id/refund', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const group = state.groups.find((g) => g.group_id === req.params.id);
    if (!group) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }
    if (group.refunded || group.status === 'refunded') {
      res.status(409).json({ error: 'Credit has already been refunded for this group.' });
      return;
    }

    const owner = state.users.find((u) => u.id === group.userId);
    if (!owner) {
      res.status(400).json({ error: 'Group is not assigned to a registered user account.' });
      return;
    }

    if (group.status === 'running' && hasUpstreamCredentials(state)) {
      await callUpstreamApi(state, {
        method: 'POST',
        path: '/api/client/group-action',
        body: { action: 'stop', group_id: group.group_id },
      });
    }

    const now = new Date().toISOString();
    const isPremium = group.tier === 'premium';
    const prevBal = isPremium ? owner.premiumCredits : owner.basicCredits;
    if (isPremium) owner.premiumCredits += 1;
    else owner.basicCredits += 1;
    const newBal = isPremium ? owner.premiumCredits : owner.basicCredits;
    owner.updatedAt = now;

    group.status = 'refunded';
    group.archived = true;
    group.running_count = 0;
    group.refunded = true;
    group.refunded_at = now;
    group.refund_requested = false;
    group.updated_at = now;

    addTransaction(state, {
      userId: owner.id,
      username: owner.username,
      type: 'refund',
      basic_credits: isPremium ? 0 : 1,
      premium_credits: isPremium ? 1 : 0,
      status: 'completed',
      performed_by: admin.username,
      details: `Admin refunded 1 ${group.tier} credit for Group #${group.group_id}`,
    });

    addCreditAudit(state, {
      operationId: `grp_refund_${group.group_id}`,
      adminId: admin.id,
      adminUsername: admin.username,
      targetUserId: owner.id,
      targetUsername: owner.username,
      operation: 'add',
      creditType: group.tier,
      amount: 1,
      previousBalance: prevBal,
      newBalance: newBal,
      reason: `Admin group refund for #${group.group_id}`,
    });

    addActivityLog(state, {
      userId: owner.id,
      username: owner.username,
      group_id: group.group_id,
      clan_id: group.clan_id,
      clan_name: group.clan_info?.decoded?.clan_name,
      region: group.region_name,
      glory_farmed: group.glory_farmed,
      action: 'refund',
      details: `Admin (${admin.username}) refunded 1 ${group.tier} credit for Group #${group.group_id}.`,
    });

    addNotification(state, {
      userId: owner.id,
      type: 'success',
      title: 'Group Credit Refunded',
      message: `Admin refunded +1 ${group.tier} credit for Group #${group.group_id}.`,
    });

    await persistState(state);
    res.json({ success: true, group, user: toPublicUser(owner) });
  });

  app.get('/api/admin/coupons', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    res.json(state.coupons);
  });

  app.post('/api/admin/coupons', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const { code, basic_credits, premium_credits, usage_limit, expires_at } = req.body as {
      code?: string;
      basic_credits?: number;
      premium_credits?: number;
      usage_limit?: number;
      expires_at?: string;
    };

    const basic = Math.max(0, Math.min(100000, Math.floor(Number(basic_credits) || 0)));
    const premium = Math.max(0, Math.min(100000, Math.floor(Number(premium_credits) || 0)));
    const limit = Math.max(1, Math.min(100000, Math.floor(Number(usage_limit) || 1)));

    if (basic + premium < 1) {
      res.status(400).json({ error: 'Coupon must include at least 1 credit.' });
      return;
    }

    const finalCode = (code ? code.trim().toUpperCase() : generateCouponCode()).replace(/[^A-Z0-9-]/g, '');
    if (finalCode.length < 4) {
      res.status(400).json({ error: 'Coupon code must be at least 4 characters.' });
      return;
    }
    if (findCoupon(state, finalCode)) {
      res.status(409).json({ error: 'Coupon code already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const newCoupon = {
      code: finalCode,
      basic_credits: basic,
      premium_credits: premium,
      status: 'active' as const,
      created_by_uid: admin.id,
      created_by: admin.username,
      is_admin_issued: true,
      usage_limit: limit,
      used_count: 0,
      redeemed_by: [],
      expires_at: expires_at && expires_at.trim() ? expires_at.trim() : null,
      created_at: now,
      updated_at: now,
    };

    state.coupons.unshift(newCoupon);
    await persistState(state);
    res.status(201).json({ success: true, coupon: newCoupon });
  });

  app.post('/api/admin/coupons/:code/disable', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const coupon = findCoupon(state, req.params.code);
    if (!coupon) {
      res.status(404).json({ error: 'Coupon not found.' });
      return;
    }
    coupon.status = 'disabled';
    coupon.updated_at = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, coupon });
  });

  app.post('/api/admin/coupons/:code/enable', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const coupon = findCoupon(state, req.params.code);
    if (!coupon) {
      res.status(404).json({ error: 'Coupon not found.' });
      return;
    }
    if (coupon.used_count >= coupon.usage_limit) {
      res.status(400).json({ error: 'Coupon already reached its usage limit.' });
      return;
    }
    coupon.status = 'active';
    coupon.updated_at = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, coupon });
  });

  app.get('/api/admin/transactions', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const status = String(req.query.status || '').trim();
    const type = String(req.query.type || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();

    const list = Array.isArray(state.transactions) ? state.transactions : [];
    const filtered = list.filter((t) => {
      if (status && t.status !== status) return false;
      if (type && t.type !== type) return false;
      if (
        q &&
        !String(t.id || '').toLowerCase().includes(q) &&
        !String(t.order_id || '').toLowerCase().includes(q) &&
        !String(t.username || '').toLowerCase().includes(q) &&
        !String(t.details || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    res.json(filtered);
  });

  app.post('/api/admin/transactions/:id/approve', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const txn = state.transactions.find((t) => t.id === req.params.id);
    if (!txn) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }
    if (txn.status !== 'pending') {
      res.status(400).json({ error: 'Only pending transactions can be approved.' });
      return;
    }
    const user = state.users.find((u) => u.id === txn.userId);
    if (!user) {
      res.status(404).json({ error: 'Transaction user not found.' });
      return;
    }

    const prevBasic = user.basicCredits;
    const prevPrem = user.premiumCredits;
    user.basicCredits += Math.max(0, txn.basic_credits);
    user.premiumCredits += Math.max(0, txn.premium_credits);
    user.updatedAt = new Date().toISOString();

    txn.status = 'approved';
    txn.performed_by = admin.username;
    txn.updated_at = new Date().toISOString();

    if (txn.basic_credits > 0) {
      addCreditAudit(state, {
        operationId: `txn_approve_b_${txn.id}`,
        adminId: admin.id,
        adminUsername: admin.username,
        targetUserId: user.id,
        targetUsername: user.username,
        operation: 'add',
        creditType: 'basic',
        amount: txn.basic_credits,
        previousBalance: prevBasic,
        newBalance: user.basicCredits,
        reason: `Approved Order #${txn.order_id}`,
      });
    }
    if (txn.premium_credits > 0) {
      addCreditAudit(state, {
        operationId: `txn_approve_p_${txn.id}`,
        adminId: admin.id,
        adminUsername: admin.username,
        targetUserId: user.id,
        targetUsername: user.username,
        operation: 'add',
        creditType: 'premium',
        amount: txn.premium_credits,
        previousBalance: prevPrem,
        newBalance: user.premiumCredits,
        reason: `Approved Order #${txn.order_id}`,
      });
    }

    addNotification(state, {
      userId: user.id,
      type: 'success',
      title: 'Credits Approved',
      message: `Order #${txn.order_id} approved: +${txn.basic_credits} Basic, +${txn.premium_credits} Premium credits.`,
    });

    await persistState(state);
    res.json({ success: true, transaction: txn });
  });

  app.post('/api/admin/transactions/:id/reject', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const txn = state.transactions.find((t) => t.id === req.params.id);
    if (!txn) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }
    if (txn.status !== 'pending') {
      res.status(400).json({ error: 'Only pending transactions can be rejected.' });
      return;
    }
    txn.status = 'cancelled';
    txn.updated_at = new Date().toISOString();
    await persistState(state);
    res.json({ success: true, transaction: txn });
  });

  app.get('/api/admin/api-config', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const providerAccount = await getProviderAccountSummary(state);
    res.json({
      baseUrl: state.apiConfig.baseUrl,
      configured: hasUpstreamCredentials(state),
      hasMasterKey: Boolean(state.apiConfig.masterKey.trim()),
      hasApiKey: Boolean(state.apiConfig.apiKey.trim()),
      masterKeyMasked: maskSecret(state.apiConfig.masterKey),
      apiKeyMasked: maskSecret(state.apiConfig.apiKey),
      providerUsername: state.apiConfig.providerUsername || providerAccount.username || '',
      hasProviderPassword: Boolean(state.apiConfig.providerPassword.trim()),
      providerPasswordMasked: maskSecret(state.apiConfig.providerPassword),
      providerAccount,
      deploymentStatus: getDeploymentStatus(state),
      lastTestedAt: state.apiConfig.lastTestedAt || null,
      lastStatus: state.apiConfig.lastStatus || 'unconfigured',
      lastMessage: state.apiConfig.lastMessage || '',
      logs: state.apiLogs.slice(0, 100),
    });
  });

  app.post('/api/admin/api-config', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const { baseUrl, masterKey, apiKey, providerUsername, providerPassword } = req.body as {
      baseUrl?: string;
      masterKey?: string;
      apiKey?: string;
      providerUsername?: string;
      providerPassword?: string;
    };

    if (baseUrl !== undefined && baseUrl.trim()) {
      try {
        const parsed = new URL(baseUrl.trim());
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          res.status(400).json({ error: 'Provider API URL must use http or https.' });
          return;
        }
        state.apiConfig.baseUrl = parsed.origin;
      } catch {
        res.status(400).json({ error: 'Invalid Provider API URL.' });
        return;
      }
    }

    if (masterKey !== undefined && masterKey.trim()) {
      state.apiConfig.masterKey = masterKey.trim();
    }
    if (apiKey !== undefined && apiKey.trim()) {
      state.apiConfig.apiKey = apiKey.trim();
    }
    if (providerUsername !== undefined) {
      state.apiConfig.providerUsername = providerUsername.trim();
    }
    if (providerPassword !== undefined && providerPassword.trim()) {
      state.apiConfig.providerPassword = providerPassword.trim();
    }

    await persistState(state);
    res.json({
      success: true,
      configured: hasUpstreamCredentials(state),
      masterKeyMasked: maskSecret(state.apiConfig.masterKey),
      apiKeyMasked: maskSecret(state.apiConfig.apiKey),
      providerUsername: state.apiConfig.providerUsername,
      providerPasswordMasked: maskSecret(state.apiConfig.providerPassword),
      baseUrl: state.apiConfig.baseUrl,
    });
  });

  app.post('/api/admin/api-test', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const pricingRes = await getLivePricing(state, true);
    const providerAccount = await getProviderAccountSummary(state, true);

    res.json({
      pricing: {
        source: pricingRes.source,
        regionsCount: pricingRes.regions.length,
        error: pricingRes.upstreamError || null,
      },
      authenticated: providerAccount,
      logs: state.apiLogs.slice(0, 30),
    });
  });

  app.get('/api/admin/settings', requireAdmin, (req: AuthedRequest, res) => {
    res.json(req.dbState!.settings);
  });

  app.put('/api/admin/settings', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const body = req.body as Partial<DatabaseState['settings']>;

    const nextSettings = {
      websiteName:
        typeof body.websiteName === 'string' && body.websiteName.trim()
          ? body.websiteName.trim().slice(0, 80)
          : state.settings.websiteName,
      websiteLogo:
        typeof body.websiteLogo === 'string'
          ? body.websiteLogo.slice(0, 500000)
          : state.settings.websiteLogo,
      websiteTitle:
        typeof body.websiteTitle === 'string'
          ? body.websiteTitle.trim().slice(0, 120)
          : state.settings.websiteTitle,
      websiteDescription:
        typeof body.websiteDescription === 'string'
          ? body.websiteDescription.trim().slice(0, 300)
          : state.settings.websiteDescription,
      websiteAnnouncement:
        typeof body.websiteAnnouncement === 'string'
          ? body.websiteAnnouncement.trim().slice(0, 500)
          : state.settings.websiteAnnouncement,
      registrationEnabled:
        typeof body.registrationEnabled === 'boolean'
          ? body.registrationEnabled
          : state.settings.registrationEnabled,
      maintenanceMode:
        typeof body.maintenanceMode === 'boolean'
          ? body.maintenanceMode
          : state.settings.maintenanceMode,
      websiteNotificationsEnabled:
        typeof body.websiteNotificationsEnabled === 'boolean'
          ? body.websiteNotificationsEnabled
          : state.settings.websiteNotificationsEnabled,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.id,
    };

    state.settings = nextSettings;
    await persistState(state);
    broadcastPublicEvent('settings', state.settings);
    res.json({ success: true, settings: state.settings });
  });

  // ==========================================
  // ADMIN: FAMWISE UPI PAYMENT GATEWAY SETTINGS
  // ==========================================

  app.get('/api/admin/famwise-config', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const cfg = state.famwiseConfig;
    res.json({
      baseUrl: cfg.baseUrl || 'https://famwise.co',
      upiId: cfg.upiId || '',
      hasApiKey: Boolean(cfg.apiKey?.trim()),
      apiKeyMasked: maskSecret(cfg.apiKey || ''),
      hasWebhookSecret: Boolean(cfg.webhookSecret?.trim()),
      webhookSecretMasked: maskSecret(cfg.webhookSecret || ''),
      basicCreditInr: cfg.basicCreditInr || 80,
      premiumCreditInr: cfg.premiumCreditInr || 160,
      lastTestedAt: cfg.lastTestedAt || null,
      lastStatus: cfg.lastStatus || 'unconfigured',
      lastMessage: cfg.lastMessage || '',
      deposits: state.deposits.slice(0, 100),
    });
  });

  app.post('/api/admin/famwise-config', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const {
      baseUrl,
      apiKey,
      upiId,
      webhookSecret,
      basicCreditInr,
      premiumCreditInr,
    } = req.body as {
      baseUrl?: string;
      apiKey?: string;
      upiId?: string;
      webhookSecret?: string;
      basicCreditInr?: number;
      premiumCreditInr?: number;
    };

    if (baseUrl !== undefined && baseUrl.trim()) {
      try {
        const parsed = new URL(baseUrl.trim());
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          res.status(400).json({ error: 'Famwise URL must use http or https.' });
          return;
        }
        state.famwiseConfig.baseUrl = parsed.origin;
      } catch {
        res.status(400).json({ error: 'Invalid Famwise base URL.' });
        return;
      }
    }

    if (apiKey !== undefined && apiKey.trim()) {
      state.famwiseConfig.apiKey = apiKey.trim();
    }
    if (upiId !== undefined) {
      const cleanUpi = upiId.trim();
      if (cleanUpi && !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(cleanUpi)) {
        res.status(400).json({ error: 'Invalid UPI ID format (e.g. name@fam).' });
        return;
      }
      state.famwiseConfig.upiId = cleanUpi;
    }
    if (webhookSecret !== undefined && webhookSecret.trim()) {
      state.famwiseConfig.webhookSecret = webhookSecret.trim();
    }
    if (basicCreditInr !== undefined) {
      const p = roundInr(Number(basicCreditInr));
      if (!Number.isFinite(p) || p < 1 || p > 100_000) {
        res.status(400).json({ error: 'Basic credit INR price must be between ₹1 and ₹100,000.' });
        return;
      }
      state.famwiseConfig.basicCreditInr = p;
    }
    if (premiumCreditInr !== undefined) {
      const p = roundInr(Number(premiumCreditInr));
      if (!Number.isFinite(p) || p < 1 || p > 100_000) {
        res.status(400).json({ error: 'Premium credit INR price must be between ₹1 and ₹100,000.' });
        return;
      }
      state.famwiseConfig.premiumCreditInr = p;
    }

    await persistState(state);
    res.json({
      success: true,
      hasApiKey: Boolean(state.famwiseConfig.apiKey?.trim()),
      apiKeyMasked: maskSecret(state.famwiseConfig.apiKey || ''),
      hasWebhookSecret: Boolean(state.famwiseConfig.webhookSecret?.trim()),
      webhookSecretMasked: maskSecret(state.famwiseConfig.webhookSecret || ''),
      upiId: state.famwiseConfig.upiId,
      baseUrl: state.famwiseConfig.baseUrl,
      basicCreditInr: state.famwiseConfig.basicCreditInr,
      premiumCreditInr: state.famwiseConfig.premiumCreditInr,
    });
  });

  app.post('/api/admin/famwise-test', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const result = await testFamwiseConnection(state);
    res.json(result);
  });

  app.get('/api/admin/deposits', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    res.json(state.deposits.slice(0, 500));
  });

  // ==========================================
  // ADMIN: YOUTUBE DATA API V3 MANAGEMENT
  // ==========================================

  app.get('/api/admin/youtube', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const key = getEffectiveYouTubeApiKey(state);
    res.json({
      configured: Boolean(key),
      apiKeyMasked: maskSecret(key),
      lastCheckedAt: state.youtubeConfig?.lastCheckedAt || null,
      lastMessage: state.youtubeConfig?.lastMessage || '',
      videos: [...state.youtubeVideos].sort(
        (a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt)
      ),
    });
  });

  app.post('/api/admin/youtube/config', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const { apiKey } = req.body as { apiKey?: string };
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) {
      res.status(400).json({ error: 'YouTube Data API v3 key is required.' });
      return;
    }
    state.youtubeConfig = {
      apiKey: cleanKey,
      lastCheckedAt: new Date().toISOString(),
      lastMessage: 'YouTube Data API v3 key saved securely on backend.',
    };
    await persistState(state);
    res.json({
      success: true,
      configured: true,
      apiKeyMasked: maskSecret(cleanKey),
    });
  });

  app.post('/api/admin/youtube/fetch', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const { url } = req.body as { url?: string };
    const apiKey = getEffectiveYouTubeApiKey(state);
    const result = await fetchYouTubeVideoMetadata(String(url || ''), apiKey);
    if (!result.ok || !result.video) {
      res.status(result.missingApiKey ? 428 : 400).json({
        error: result.error || 'Could not fetch video metadata.',
        missingApiKey: Boolean(result.missingApiKey),
      });
      return;
    }
    state.youtubeConfig.lastCheckedAt = new Date().toISOString();
    state.youtubeConfig.lastMessage = `Verified YouTube video: ${result.video.title}`;
    await persistState(state);
    res.json({ success: true, video: result.video });
  });

  app.post('/api/admin/youtube/videos', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const { url, title, description, thumbnailUrl, channelTitle, published } = req.body as {
      url?: string;
      title?: string;
      description?: string;
      thumbnailUrl?: string;
      channelTitle?: string;
      published?: boolean;
    };

    const videoId = extractYouTubeVideoId(String(url || ''));
    if (!videoId) {
      res.status(400).json({ error: 'Please enter a valid YouTube URL or 11-character video ID.' });
      return;
    }

    let resolvedTitle = (title || '').trim();
    let resolvedDesc = (description || '').trim();
    let resolvedThumb = (thumbnailUrl || '').trim();
    let resolvedChannel = (channelTitle || '').trim();

    if (!resolvedTitle || !resolvedThumb) {
      const apiKey = getEffectiveYouTubeApiKey(state);
      const fetched = await fetchYouTubeVideoMetadata(videoId, apiKey);
      if (fetched.ok && fetched.video) {
        resolvedTitle = resolvedTitle || fetched.video.title;
        resolvedDesc = resolvedDesc || fetched.video.description;
        resolvedThumb = resolvedThumb || fetched.video.thumbnailUrl;
        resolvedChannel = resolvedChannel || fetched.video.channelTitle;
      } else if (!resolvedTitle) {
        res.status(fetched.missingApiKey ? 428 : 400).json({
          error:
            fetched.error ||
            'Provide a video title or configure YOUTUBE_API_KEY to fetch metadata automatically.',
          missingApiKey: Boolean(fetched.missingApiKey),
        });
        return;
      }
    }

    const now = new Date().toISOString();
    const record: YouTubeVideoRecord = {
      id: `yt_${crypto.randomBytes(6).toString('hex')}`,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: resolvedTitle.slice(0, 160),
      description: resolvedDesc.slice(0, 2000),
      thumbnailUrl: resolvedThumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      channelTitle: resolvedChannel.slice(0, 120),
      published: published !== false,
      order: state.youtubeVideos.length,
      createdAt: now,
      updatedAt: now,
    };

    state.youtubeVideos.push(record);
    await persistState(state);
    const publishedVideos = state.youtubeVideos
      .filter((v) => v.published)
      .sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    broadcastPublicEvent('youtube', publishedVideos);
    res.status(201).json({ success: true, video: record });
  });

  app.put('/api/admin/youtube/videos/:id', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const idx = state.youtubeVideos.findIndex((v) => v.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'YouTube video not found.' });
      return;
    }

    const existing = state.youtubeVideos[idx];
    const body = req.body as Partial<YouTubeVideoRecord>;
    let nextVideoId = existing.videoId;
    let nextUrl = existing.url;

    if (typeof body.url === 'string' && body.url.trim()) {
      const parsedId = extractYouTubeVideoId(body.url);
      if (!parsedId) {
        res.status(400).json({ error: 'Invalid YouTube URL or video ID.' });
        return;
      }
      nextVideoId = parsedId;
      nextUrl = `https://www.youtube.com/watch?v=${parsedId}`;
    }

    const updated: YouTubeVideoRecord = {
      ...existing,
      videoId: nextVideoId,
      url: nextUrl,
      title:
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim().slice(0, 160)
          : existing.title,
      description:
        typeof body.description === 'string'
          ? body.description.trim().slice(0, 2000)
          : existing.description,
      thumbnailUrl:
        typeof body.thumbnailUrl === 'string' && body.thumbnailUrl.trim()
          ? body.thumbnailUrl.trim().slice(0, 500)
          : existing.thumbnailUrl,
      channelTitle:
        typeof body.channelTitle === 'string'
          ? body.channelTitle.trim().slice(0, 120)
          : existing.channelTitle,
      published: typeof body.published === 'boolean' ? body.published : existing.published,
      order: typeof body.order === 'number' && Number.isFinite(body.order) ? body.order : existing.order,
      updatedAt: new Date().toISOString(),
    };

    state.youtubeVideos[idx] = updated;
    await persistState(state);
    const publishedVideos = state.youtubeVideos
      .filter((v) => v.published)
      .sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    broadcastPublicEvent('youtube', publishedVideos);
    res.json({ success: true, video: updated });
  });

  app.delete('/api/admin/youtube/videos/:id', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const idx = state.youtubeVideos.findIndex((v) => v.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'YouTube video not found.' });
      return;
    }
    state.youtubeVideos.splice(idx, 1);
    await persistState(state);
    const publishedVideos = state.youtubeVideos
      .filter((v) => v.published)
      .sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    broadcastPublicEvent('youtube', publishedVideos);
    res.json({ success: true });
  });

  app.get('/api/admin/logs', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    res.json({
      apiLogs: state.apiLogs.slice(0, 200),
      activityLogs: state.activityLogs.slice(0, 200),
    });
  });

  // ==========================================
  // ADMIN: PERMANENT JSON BACKUP, RESTORE & ENV EXPORT
  // ==========================================

  app.get('/api/admin/backup/export-json', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const envelope = createPlainBackup(state);
    const jsonText = JSON.stringify(envelope, null, 2);
    const dateTag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="kakarot-glory-pro-backup-${dateTag}.json"`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(jsonText);
  });

  app.post('/api/admin/backup/export-encrypted', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const { passphrase } = req.body as { passphrase?: string };
    try {
      const envelope = createEncryptedBackup(state, passphrase || '');
      const jsonText = JSON.stringify(envelope, null, 2);
      const dateTag = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="kakarot-glory-pro-encrypted-backup-${dateTag}.json"`
      );
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(jsonText);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to create encrypted backup.',
      });
    }
  });

  app.get('/api/admin/backup/export-env', requireAdmin, (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const envExport = buildHostDeploymentEnvText(state);
    res.json(envExport);
  });

  app.post('/api/admin/backup/import', requireAdmin, async (req: AuthedRequest, res) => {
    const state = req.dbState!;
    const admin = req.authUser!;
    const { payload, passphrase } = req.body as {
      payload?: unknown;
      passphrase?: string;
    };

    if (payload === undefined || payload === null || payload === '') {
      res.status(400).json({ error: 'Backup JSON file or content is required.' });
      return;
    }

    let imported: DatabaseState;
    try {
      imported = parseAnyBackupPayload(payload, passphrase || '');
    } catch (err) {
      if (err instanceof BackupPassphraseRequiredError) {
        res.status(400).json({ error: err.message, requiresPassphrase: true });
        return;
      }
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to parse backup JSON.',
      });
      return;
    }

    // Preserve active sessionSecret and ensure current admin keeps valid access
    const currentSessionSecret = state.sessionSecret;
    const currentAdmin = state.users.find((u) => u.id === 'admin_super_1' || u.id === admin.id);

    const importedHasSuperAdmin = imported.users.some(
      (u) => u.id === 'admin_super_1' && u.role === 'admin'
    );
    if (!importedHasSuperAdmin && currentAdmin) {
      imported.users.unshift({ ...currentAdmin });
    } else if (currentAdmin) {
      const impAdmin = imported.users.find(
        (u) => u.id === 'admin_super_1' && u.role === 'admin'
      );
      if (impAdmin && !impAdmin.passwordHash) {
        impAdmin.passwordHash = currentAdmin.passwordHash;
      }
    }

    imported.sessionSecret = currentSessionSecret || imported.sessionSecret;
    imported.settings = {
      ...imported.settings,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.id,
    };

    Object.assign(state, imported);

    addActivityLog(state, {
      userId: admin.id,
      username: admin.username,
      action: 'credit_set',
      details: `Restored full website state & provider credentials from uploaded JSON backup.`,
    });

    await persistState(state);

    broadcastPublicEvent('settings', state.settings);
    const publishedVideos = state.youtubeVideos
      .filter((v) => v.published)
      .sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    broadcastPublicEvent('youtube', publishedVideos);

    res.json({
      success: true,
      message: 'Backup JSON restored and saved permanently across backend & providers.',
      settings: state.settings,
      deploymentStatus: getDeploymentStatus(state),
      restored: {
        users: state.users.filter((u) => u.role !== 'admin').length,
        groups: state.groups.length,
        transactions: state.transactions.length,
        deposits: state.deposits.length,
        coupons: state.coupons.length,
        youtubeVideos: state.youtubeVideos.length,
        hasProviderKeys: Boolean(state.apiConfig.apiKey?.trim() && state.apiConfig.masterKey?.trim()),
        hasFamwiseKey: Boolean(state.famwiseConfig.apiKey?.trim()),
        hasYoutubeKey: Boolean(state.youtubeConfig.apiKey?.trim()),
      },
    });
  });

  app.get('/api/admin/download-source-zip', requireAdmin, async (_req: AuthedRequest, res) => {
    try {
      const archive = await buildSourceCodeZip(process.cwd());
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="kakarot-glory-pro-source-code.zip"'
      );
      res.setHeader('Content-Length', String(archive.buffer.length));
      res.setHeader('X-Source-File-Count', String(archive.fileCount));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(archive.buffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build source code archive.',
      });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message =
      err instanceof SyntaxError
        ? 'Invalid JSON request body.'
        : err instanceof Error
          ? err.message
          : 'Internal server error.';
    if (!res.headersSent) {
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
  });

  return app;
}
