import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.ts';
import type {
  ActivityLogRecord,
  ApiLogRecord,
  CouponRecord,
  CreditAuditRecord,
  DatabaseState,
  GroupRecord,
  NotificationItem,
  PublicUser,
  TransactionRecord,
  UserRecord,
} from './types.ts';

function resolveDataFile(): string {
  const localDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    fs.accessSync(localDir, fs.constants.W_OK);
    return path.join(localDir, 'kakarot_db.json');
  } catch {
    return '/tmp/kakarot_db.json';
  }
}

const DATA_FILE = resolveDataFile();

let firestoreDb: import('firebase-admin/firestore').Firestore | null = null;
let firestoreAttempted = false;

export function normalizePrivateKeyPem(rawKey: string): string {
  let key = String(rawKey || '').trim();
  if (!key) return '';

  // Strip accidental surrounding quotes
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'")) ||
    (key.startsWith('`') && key.endsWith('`'))
  ) {
    key = key.slice(1, -1).trim();
  }

  // Collapse double/single escaped newlines and CRLF
  key = key
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');

  // Re-wrap PEM header/body/footer cleanly when env UI flattens newlines to spaces
  const pemMatch = key.match(
    /(-----BEGIN (?:RSA )?PRIVATE KEY-----)([\s\S]*?)(-----END (?:RSA )?PRIVATE KEY-----)/
  );
  if (pemMatch) {
    const header = pemMatch[1];
    const footer = pemMatch[3];
    const cleanBody = pemMatch[2].replace(/[\s\\]/g, '');
    if (cleanBody.length > 0) {
      const wrappedBody = cleanBody.match(/.{1,64}/g)?.join('\n') || cleanBody;
      return `${header}\n${wrappedBody}\n${footer}\n`;
    }
  }

  return key.endsWith('\n') ? key : `${key}\n`;
}

export function validateServiceAccountPrivateKey(pem: string): boolean {
  if (!pem || !pem.includes('PRIVATE KEY')) return false;
  try {
    crypto.createPrivateKey({ key: pem, format: 'pem' });
    return true;
  } catch {
    return false;
  }
}

export function parseServiceAccountJson(raw: string): Record<string, string> | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip single quotes or backticks from shell/env UI copy-paste (never valid JSON delimiters)
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Support base64-encoded service account JSON strings
  if (!trimmed.startsWith('{') && !trimmed.startsWith('"')) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) {
        trimmed = decoded;
      }
    } catch {
      // ignore non-base64
    }
  }

  const tryParseObject = (candidate: string): unknown => {
    let parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    return parsed;
  };

  let parsed: unknown;
  try {
    parsed = tryParseObject(trimmed);
  } catch {
    // Fallback: handle unescaped double-quoted wrapper like "{"type":...}"
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
      try {
        parsed = tryParseObject(trimmed.slice(1, -1).trim());
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, string>;
  if (typeof record.private_key === 'string') {
    record.private_key = normalizePrivateKeyPem(record.private_key);
  }
  return record;
}

async function getAdminFirestore(): Promise<import('firebase-admin/firestore').Firestore | null> {
  if (firestoreAttempted) return firestoreDb;
  firestoreAttempted = true;

  const serviceJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceJson || !serviceJson.trim()) return null;

  try {
    const parsedCert = parseServiceAccountJson(serviceJson);
    if (!parsedCert || !parsedCert.project_id || !parsedCert.client_email || !parsedCert.private_key) {
      console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is invalid or missing required fields; using local persistence.');
      return null;
    }

    if (!validateServiceAccountPrivateKey(parsedCert.private_key)) {
      console.warn('FIREBASE_SERVICE_ACCOUNT_JSON private_key is malformed or incomplete; using local persistence.');
      return null;
    }

    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    let databaseId: string | undefined;
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        firestoreDatabaseId?: string;
        projectId?: string;
      };
      databaseId = cfg.firestoreDatabaseId;
    }
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(parsedCert) });
    firestoreDb =
      databaseId && databaseId !== '(default)'
        ? getFirestore(app, databaseId)
        : getFirestore(app);
    return firestoreDb;
  } catch (err) {
    console.warn('Firebase Admin Firestore unavailable, using local persistence:', (err as Error).message);
    return null;
  }
}

function getEnvProviderConfig() {
  const baseUrl =
    process.env.PROVIDER_API_URL || process.env.FFGLORY_BASE_URL || 'https://ffglory.pro';
  const apiKey = process.env.PROVIDER_API_KEY || process.env.FFGLORY_API_KEY || '';
  const masterKey = process.env.PROVIDER_MASTER_KEY || process.env.FFGLORY_MASTER_KEY || '';
  const providerUsername = process.env.PROVIDER_USERNAME || '';
  const providerPassword = process.env.PROVIDER_PASSWORD || '';
  return { baseUrl, apiKey, masterKey, providerUsername, providerPassword };
}

function getEnvFamwiseConfig() {
  const baseUrl = (process.env.FAMWISE_BASE_URL || 'https://famwise.co').replace(/\/+$/, '');
  const apiKey = process.env.FAMWISE_API_KEY || '';
  const upiId = process.env.FAMWISE_UPI_ID || '';
  const webhookSecret = process.env.FAMWISE_WEBHOOK_SECRET || '';
  return { baseUrl, apiKey, upiId, webhookSecret };
}

function getEnvAdminAccessKey(): string {
  return (process.env.ADMIN_ACCESS_KEY || process.env.ADMIN_PASSWORD || '').trim();
}

// One-way salted scrypt hash fallback so fresh serverless cold starts
// still require Admin Access Key login without storing any plaintext key in source.
const DEFAULT_ADMIN_KEY_HASH =
  '425607ae6f85b09c4bb97066ed7ecd5b:d841d700e760c73f433b195f65752bca2788829d97e40818c2f7646513ed3402362cbcf259dedf36e2f1abcfe55c3a0256092bb69f6c6e667e6e16dfe7be5575';

function computeKeyFingerprint(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function createInitialState(): DatabaseState {
  const now = new Date().toISOString();
  const adminUsername = (process.env.ADMIN_USERNAME || 'harshverma5708').toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || 'ffharsh813@gmail.com').toLowerCase();
  const envAdminKey = getEnvAdminAccessKey();
  const providerEnv = getEnvProviderConfig();
  const famwiseEnv = getEnvFamwiseConfig();
  const youtubeApiKey = (process.env.YOUTUBE_API_KEY || '').trim();

  const superAdmin: UserRecord = {
    id: 'admin_super_1',
    username: adminUsername,
    email: adminEmail,
    passwordHash: envAdminKey ? hashPassword(envAdminKey) : DEFAULT_ADMIN_KEY_HASH,
    role: 'admin',
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

  return {
    settings: {
      websiteName: 'KAKAROT GLORY PRO',
      websiteLogo: '',
      websiteTitle: 'KAKAROT GLORY PRO',
      websiteDescription:
        'KAKAROT GLORY PRO — Automated Clan Glory Group Management, Credits, Coupons & Admin Control Panel.',
      websiteAnnouncement: '',
      registrationEnabled: true,
      maintenanceMode: false,
      websiteNotificationsEnabled: true,
      updatedAt: now,
      updatedBy: superAdmin.id,
    },
    apiConfig: {
      baseUrl: providerEnv.baseUrl,
      masterKey: providerEnv.masterKey,
      apiKey: providerEnv.apiKey,
      providerUsername: providerEnv.providerUsername,
      providerPassword: providerEnv.providerPassword,
      lastStatus:
        providerEnv.masterKey && providerEnv.apiKey ? 'connected' : 'unconfigured',
      lastMessage:
        providerEnv.masterKey && providerEnv.apiKey
          ? 'Loaded provider credentials from secure backend environment'
          : 'Provider API keys not configured yet',
    },
    famwiseConfig: {
      baseUrl: famwiseEnv.baseUrl,
      apiKey: famwiseEnv.apiKey,
      upiId: famwiseEnv.upiId,
      webhookSecret: famwiseEnv.webhookSecret,
      basicCreditInr: 80,
      premiumCreditInr: 160,
      lastStatus: famwiseEnv.apiKey ? 'connected' : 'unconfigured',
      lastMessage: famwiseEnv.apiKey
        ? 'Loaded Famwise gateway key from secure backend environment'
        : 'Famwise API key not configured yet',
    },
    youtubeConfig: {
      apiKey: youtubeApiKey,
      lastMessage: youtubeApiKey
        ? 'Loaded YouTube Data API v3 key from environment'
        : 'YOUTUBE_API_KEY not configured yet',
    },
    adminSetupRequired: false,
    adminEnvKeyFingerprint: envAdminKey ? computeKeyFingerprint(envAdminKey) : undefined,
    users: [superAdmin],
    groups: [],
    transactions: [],
    deposits: [],
    creditedDepositOrderIds: [],
    creditAudits: [],
    processedOperationIds: [],
    coupons: [],
    youtubeVideos: [],
    activityLogs: [],
    notifications: [],
    apiLogs: [],
    sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  };
}

let memoryState: DatabaseState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function hydrateStateWithEnv(state: DatabaseState): DatabaseState {
  const providerEnv = getEnvProviderConfig();
  const famwiseEnv = getEnvFamwiseConfig();
  if (!state.apiConfig) {
    state.apiConfig = {
      baseUrl: providerEnv.baseUrl,
      masterKey: providerEnv.masterKey,
      apiKey: providerEnv.apiKey,
      providerUsername: providerEnv.providerUsername,
      providerPassword: providerEnv.providerPassword,
    };
  }
  if (providerEnv.baseUrl && !state.apiConfig.baseUrl) state.apiConfig.baseUrl = providerEnv.baseUrl;
  if (providerEnv.masterKey && !state.apiConfig.masterKey) state.apiConfig.masterKey = providerEnv.masterKey;
  if (providerEnv.apiKey && !state.apiConfig.apiKey) state.apiConfig.apiKey = providerEnv.apiKey;
  if (providerEnv.providerUsername && !state.apiConfig.providerUsername) {
    state.apiConfig.providerUsername = providerEnv.providerUsername;
  }
  if (providerEnv.providerPassword && !state.apiConfig.providerPassword) {
    state.apiConfig.providerPassword = providerEnv.providerPassword;
  }
  if (
    state.apiConfig.masterKey.trim() &&
    state.apiConfig.apiKey.trim() &&
    (!state.apiConfig.lastStatus || state.apiConfig.lastStatus === 'unconfigured')
  ) {
    state.apiConfig.lastStatus = 'connected';
    state.apiConfig.lastMessage = 'Loaded provider credentials from secure backend environment';
  }

  if (!state.famwiseConfig) {
    state.famwiseConfig = {
      baseUrl: famwiseEnv.baseUrl,
      apiKey: famwiseEnv.apiKey,
      upiId: famwiseEnv.upiId,
      webhookSecret: famwiseEnv.webhookSecret,
      basicCreditInr: 80,
      premiumCreditInr: 160,
      lastStatus: famwiseEnv.apiKey ? 'connected' : 'unconfigured',
      lastMessage: famwiseEnv.apiKey
        ? 'Loaded Famwise gateway key from secure backend environment'
        : 'Famwise API key not configured yet',
    };
  }
  if (famwiseEnv.baseUrl && !state.famwiseConfig.baseUrl) {
    state.famwiseConfig.baseUrl = famwiseEnv.baseUrl;
  }
  if (state.famwiseConfig.baseUrl) {
    try {
      state.famwiseConfig.baseUrl = new URL(state.famwiseConfig.baseUrl).origin;
    } catch {
      state.famwiseConfig.baseUrl = 'https://famwise.co';
    }
  }
  if (famwiseEnv.apiKey && !state.famwiseConfig.apiKey) {
    state.famwiseConfig.apiKey = famwiseEnv.apiKey;
  }
  if (
    state.famwiseConfig.apiKey?.trim() &&
    (!state.famwiseConfig.lastStatus || state.famwiseConfig.lastStatus === 'unconfigured')
  ) {
    state.famwiseConfig.lastStatus = 'connected';
    state.famwiseConfig.lastMessage = 'Loaded Famwise gateway key from secure backend environment';
  }
  if (famwiseEnv.upiId && !state.famwiseConfig.upiId) {
    state.famwiseConfig.upiId = famwiseEnv.upiId;
  }
  if (famwiseEnv.webhookSecret && !state.famwiseConfig.webhookSecret) {
    state.famwiseConfig.webhookSecret = famwiseEnv.webhookSecret;
  }
  if (typeof state.famwiseConfig.basicCreditInr !== 'number' || state.famwiseConfig.basicCreditInr < 1) {
    state.famwiseConfig.basicCreditInr = 80;
  }
  if (typeof state.famwiseConfig.premiumCreditInr !== 'number' || state.famwiseConfig.premiumCreditInr < 1) {
    state.famwiseConfig.premiumCreditInr = 160;
  }

  if (!state.youtubeConfig) {
    state.youtubeConfig = {
      apiKey: (process.env.YOUTUBE_API_KEY || '').trim(),
    };
  }
  if (!state.youtubeConfig.apiKey && process.env.YOUTUBE_API_KEY) {
    state.youtubeConfig.apiKey = process.env.YOUTUBE_API_KEY.trim();
  }
  if (!Array.isArray(state.users)) state.users = [];
  if (!Array.isArray(state.groups)) state.groups = [];
  if (!Array.isArray(state.transactions)) state.transactions = [];
  if (!Array.isArray(state.coupons)) state.coupons = [];
  if (!Array.isArray(state.youtubeVideos)) state.youtubeVideos = [];
  if (!Array.isArray(state.activityLogs)) state.activityLogs = [];
  if (!Array.isArray(state.notifications)) state.notifications = [];
  if (!Array.isArray(state.apiLogs)) state.apiLogs = [];

  if (!Array.isArray(state.deposits)) state.deposits = [];
  if (!Array.isArray(state.creditedDepositOrderIds)) state.creditedDepositOrderIds = [];
  if (!Array.isArray(state.creditAudits)) state.creditAudits = [];
  if (!Array.isArray(state.processedOperationIds)) state.processedOperationIds = [];

  for (const u of state.users) {
    if (typeof u.walletBalance !== 'number' || !Number.isFinite(u.walletBalance)) {
      u.walletBalance = 0;
    }
  }

  if (process.env.SESSION_SECRET) {
    state.sessionSecret = process.env.SESSION_SECRET;
  }

  const envAdminKey = getEnvAdminAccessKey();
  const superAdmin = state.users.find((u) => u.id === 'admin_super_1' && u.role === 'admin');
  if (superAdmin && process.env.ADMIN_USERNAME) {
    superAdmin.username = process.env.ADMIN_USERNAME.trim().toLowerCase();
  }
  if (superAdmin && process.env.ADMIN_EMAIL) {
    superAdmin.email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  }
  if (envAdminKey) {
    const envFingerprint = computeKeyFingerprint(envAdminKey);
    if (superAdmin && (!superAdmin.passwordHash || state.adminEnvKeyFingerprint !== envFingerprint)) {
      superAdmin.passwordHash = hashPassword(envAdminKey);
      superAdmin.updatedAt = new Date().toISOString();
      state.adminEnvKeyFingerprint = envFingerprint;
    }
    state.adminSetupRequired = false;
  } else {
    if (superAdmin && !superAdmin.passwordHash) {
      superAdmin.passwordHash = DEFAULT_ADMIN_KEY_HASH;
    }
    const admin = state.users.find((u) => u.role === 'admin');
    state.adminSetupRequired = !admin?.passwordHash;
  }
  return state;
}

export interface DeploymentStatusInfo {
  isServerless: boolean;
  platform: 'node';
  firestorePersistence: boolean;
  hasProviderEnv: boolean;
  hasProviderInStore: boolean;
  hasAdminEnv: boolean;
  hasFamwiseEnv: boolean;
  hasSessionSecretEnv: boolean;
  missingEnvVars: string[];
}

export function getDeploymentStatus(state: DatabaseState): DeploymentStatusInfo {
  const firestorePersistence = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
  const hasProviderEnv = Boolean(
    (process.env.PROVIDER_API_KEY || process.env.FFGLORY_API_KEY)?.trim() &&
      (process.env.PROVIDER_MASTER_KEY || process.env.FFGLORY_MASTER_KEY)?.trim()
  );
  const hasProviderInStore = Boolean(
    state.apiConfig.apiKey?.trim() && state.apiConfig.masterKey?.trim()
  );
  const hasAdminEnv = Boolean(getEnvAdminAccessKey());
  const hasFamwiseEnv = Boolean(process.env.FAMWISE_API_KEY?.trim());
  const hasSessionSecretEnv = Boolean(process.env.SESSION_SECRET?.trim());

  const missingEnvVars: string[] = [];
  if (!firestorePersistence) missingEnvVars.push('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!hasProviderEnv) {
    if (!(process.env.PROVIDER_API_KEY || process.env.FFGLORY_API_KEY)?.trim()) {
      missingEnvVars.push('PROVIDER_API_KEY');
    }
    if (!(process.env.PROVIDER_MASTER_KEY || process.env.FFGLORY_MASTER_KEY)?.trim()) {
      missingEnvVars.push('PROVIDER_MASTER_KEY');
    }
  }
  if (!hasAdminEnv) missingEnvVars.push('ADMIN_ACCESS_KEY');
  if (!hasFamwiseEnv) missingEnvVars.push('FAMWISE_API_KEY');
  if (!hasSessionSecretEnv) missingEnvVars.push('SESSION_SECRET');

  return {
    isServerless: false,
    platform: 'node',
    firestorePersistence,
    hasProviderEnv,
    hasProviderInStore,
    hasAdminEnv,
    hasFamwiseEnv,
    hasSessionSecretEnv,
    missingEnvVars,
  };
}

export async function loadState(): Promise<DatabaseState> {
  if (memoryState) {
    return hydrateStateWithEnv(memoryState);
  }

  const db = await getAdminFirestore();
  if (db) {
    try {
      const snap = await db.collection('_system_state').doc('primary').get();
      if (snap.exists) {
        memoryState = hydrateStateWithEnv(snap.data() as DatabaseState);
        return memoryState;
      }
    } catch (err) {
      console.error('Firestore state read failed, falling back to local file:', (err as Error).message);
    }
  }

  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as DatabaseState;
      if (parsed && parsed.settings && Array.isArray(parsed.users)) {
        memoryState = hydrateStateWithEnv(parsed);
        return memoryState;
      }
    } catch {
      // Fall through to fresh initial state
    }
  }

  memoryState = createInitialState();
  await persistState(memoryState);
  return memoryState;
}

export async function persistState(state: DatabaseState): Promise<void> {
  memoryState = state;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const tmpFile = `${DATA_FILE}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(tmpFile, DATA_FILE);
      } catch (err) {
        console.error('Local store persist warning:', (err as Error).message);
      }

      const db = await getAdminFirestore();
      if (db) {
        try {
          await db.collection('_system_state').doc('primary').set(state);
          await db.collection('settings').doc('site').set(state.settings);
        } catch (err) {
          console.error('Firestore state persist warning:', (err as Error).message);
        }
      }
    });
  await writeQueue;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    basicCredits: user.basicCredits,
    premiumCredits: user.premiumCredits,
    walletBalance: Number(Number(user.walletBalance ?? 0).toFixed(2)),
    maxGroups: user.maxGroups,
    blocked: user.blocked,
    language: user.language || 'en',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••••••${value.slice(-4)}`;
}

export function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () =>
    Array.from({ length: 4 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  return `${seg()}-${seg()}-${seg()}`;
}

export function addTransaction(
  state: DatabaseState,
  input: Omit<TransactionRecord, 'id' | 'order_id' | 'created_at' | 'updated_at'> & {
    id?: string;
    order_id?: string;
  }
): TransactionRecord {
  const now = new Date().toISOString();
  const txn: TransactionRecord = {
    id: input.id || `txn_${crypto.randomBytes(6).toString('hex')}`,
    order_id: input.order_id || `${Date.now()}${crypto.randomInt(1000, 9999)}`,
    userId: input.userId,
    username: input.username,
    type: input.type,
    basic_credits: input.basic_credits,
    premium_credits: input.premium_credits,
    amount_inr: input.amount_inr,
    status: input.status,
    details: input.details,
    performed_by: input.performed_by,
    created_at: now,
    updated_at: now,
  };
  state.transactions.unshift(txn);
  if (state.transactions.length > 5000) {
    state.transactions = state.transactions.slice(0, 5000);
  }
  return txn;
}

export function addCreditAudit(
  state: DatabaseState,
  input: Omit<CreditAuditRecord, 'id' | 'timestamp'>
): CreditAuditRecord {
  const audit: CreditAuditRecord = {
    id: `aud_${crypto.randomBytes(6).toString('hex')}`,
    ...input,
    timestamp: new Date().toISOString(),
  };
  state.creditAudits.unshift(audit);
  if (state.creditAudits.length > 5000) {
    state.creditAudits = state.creditAudits.slice(0, 5000);
  }
  if (input.operationId) {
    state.processedOperationIds.push(input.operationId);
    if (state.processedOperationIds.length > 2000) {
      state.processedOperationIds = state.processedOperationIds.slice(-2000);
    }
  }
  return audit;
}

export function addActivityLog(
  state: DatabaseState,
  input: Omit<ActivityLogRecord, 'id' | 'timestamp'>
): ActivityLogRecord {
  const entry: ActivityLogRecord = {
    id: `act_${crypto.randomBytes(6).toString('hex')}`,
    ...input,
    timestamp: new Date().toISOString(),
  };
  state.activityLogs.unshift(entry);
  if (state.activityLogs.length > 2000) {
    state.activityLogs = state.activityLogs.slice(0, 2000);
  }
  return entry;
}

export function addNotification(
  state: DatabaseState,
  input: Omit<NotificationItem, 'id' | 'read' | 'created_at'>
): NotificationItem {
  const notif: NotificationItem = {
    id: `notif_${crypto.randomBytes(6).toString('hex')}`,
    ...input,
    read: false,
    created_at: new Date().toISOString(),
  };
  state.notifications.unshift(notif);
  if (state.notifications.length > 500) {
    state.notifications = state.notifications.slice(0, 500);
  }
  return notif;
}

export function addApiLog(
  state: DatabaseState,
  input: Omit<ApiLogRecord, 'id' | 'timestamp'>
): ApiLogRecord {
  const entry: ApiLogRecord = {
    id: `api_${crypto.randomBytes(5).toString('hex')}`,
    ...input,
    timestamp: new Date().toISOString(),
  };
  state.apiLogs.unshift(entry);
  if (state.apiLogs.length > 300) {
    state.apiLogs = state.apiLogs.slice(0, 300);
  }
  return entry;
}

export function upsertGroup(state: DatabaseState, group: GroupRecord): void {
  const idx = state.groups.findIndex((g) => g.group_id === group.group_id);
  if (idx >= 0) {
    state.groups[idx] = { ...state.groups[idx], ...group };
  } else {
    state.groups.unshift(group);
  }
}

export function findCoupon(state: DatabaseState, code: string): CouponRecord | undefined {
  const normalized = code.trim().toUpperCase();
  return state.coupons.find((c) => c.code.toUpperCase() === normalized);
}
