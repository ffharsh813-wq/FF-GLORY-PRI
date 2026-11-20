import crypto from 'node:crypto';
import type { DatabaseState } from './types.ts';

export interface EncryptedBackupEnvelope {
  format: 'kakarot-glory-pro-backup-v1';
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  createdAt: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  stats: {
    users: number;
    groups: number;
    transactions: number;
    deposits: number;
    coupons: number;
    youtubeVideos: number;
    hasProviderKeys: boolean;
    hasFamwiseKey: boolean;
  };
}

function deriveKey(passphrase: string, saltHex: string): Buffer {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function createEncryptedBackup(
  state: DatabaseState,
  passphrase: string
): EncryptedBackupEnvelope {
  const cleanPass = passphrase.trim();
  if (cleanPass.length < 6) {
    throw new Error('Backup passphrase must be at least 6 characters.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(12);
  const key = deriveKey(cleanPass, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(state);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    format: 'kakarot-glory-pro-backup-v1',
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    createdAt: new Date().toISOString(),
    salt,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('base64'),
    stats: {
      users: state.users.filter((u) => u.role !== 'admin').length,
      groups: state.groups.length,
      transactions: state.transactions.length,
      deposits: state.deposits.length,
      coupons: state.coupons.length,
      youtubeVideos: state.youtubeVideos.length,
      hasProviderKeys: Boolean(state.apiConfig?.apiKey?.trim() && state.apiConfig?.masterKey?.trim()),
      hasFamwiseKey: Boolean(state.famwiseConfig?.apiKey?.trim()),
    },
  };
}

export function decryptAndValidateBackup(
  envelopeInput: unknown,
  passphrase: string
): DatabaseState {
  const cleanPass = passphrase.trim();
  if (!cleanPass) {
    throw new Error('Backup passphrase is required.');
  }

  let parsedEnvelope: unknown = envelopeInput;
  if (typeof envelopeInput === 'string') {
    try {
      parsedEnvelope = JSON.parse(envelopeInput);
    } catch {
      throw new Error('Invalid backup JSON file.');
    }
  }

  if (!parsedEnvelope || typeof parsedEnvelope !== 'object') {
    throw new Error('Invalid backup file structure.');
  }

  const env = parsedEnvelope as Partial<EncryptedBackupEnvelope>;
  if (
    env.format !== 'kakarot-glory-pro-backup-v1' ||
    env.algorithm !== 'aes-256-gcm' ||
    !env.salt ||
    !env.iv ||
    !env.authTag ||
    !env.ciphertext
  ) {
    throw new Error('Unsupported or corrupted backup file format.');
  }

  let decryptedText = '';
  try {
    const key = deriveKey(cleanPass, env.salt);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(env.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(env.authTag, 'hex'));
    const plainBuf = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, 'base64')),
      decipher.final(),
    ]);
    decryptedText = plainBuf.toString('utf8');
  } catch {
    throw new Error('Incorrect backup passphrase or corrupted backup payload.');
  }

  let state: unknown;
  try {
    state = JSON.parse(decryptedText);
  } catch {
    throw new Error('Decrypted backup payload is not valid JSON.');
  }

  if (!state || typeof state !== 'object') {
    throw new Error('Restored state is invalid.');
  }

  const candidate = state as Partial<DatabaseState>;
  if (!candidate.settings || !Array.isArray(candidate.users)) {
    throw new Error('Backup does not contain required website state.');
  }

  return candidate as DatabaseState;
}

export interface PlainBackupEnvelope {
  format: 'kakarot-glory-pro-plain-backup-v1';
  createdAt: string;
  stats: {
    users: number;
    groups: number;
    transactions: number;
    deposits: number;
    coupons: number;
    youtubeVideos: number;
    hasProviderKeys: boolean;
    hasFamwiseKey: boolean;
    hasYoutubeKey: boolean;
  };
  state: DatabaseState;
}

export function createPlainBackup(state: DatabaseState): PlainBackupEnvelope {
  const cloned = JSON.parse(JSON.stringify(state)) as DatabaseState;
  if (Array.isArray(cloned.apiLogs) && cloned.apiLogs.length > 50) {
    cloned.apiLogs = cloned.apiLogs.slice(0, 50);
  }
  return {
    format: 'kakarot-glory-pro-plain-backup-v1',
    createdAt: new Date().toISOString(),
    stats: {
      users: (cloned.users || []).filter((u) => u.role !== 'admin').length,
      groups: (cloned.groups || []).length,
      transactions: (cloned.transactions || []).length,
      deposits: (cloned.deposits || []).length,
      coupons: (cloned.coupons || []).length,
      youtubeVideos: (cloned.youtubeVideos || []).length,
      hasProviderKeys: Boolean(cloned.apiConfig?.apiKey?.trim() && cloned.apiConfig?.masterKey?.trim()),
      hasFamwiseKey: Boolean(cloned.famwiseConfig?.apiKey?.trim()),
      hasYoutubeKey: Boolean(cloned.youtubeConfig?.apiKey?.trim()),
    },
    state: cloned,
  };
}

export class BackupPassphraseRequiredError extends Error {
  requiresPassphrase = true;
  constructor(message = 'This backup file is encrypted. Enter your backup passphrase to restore it.') {
    super(message);
    this.name = 'BackupPassphraseRequiredError';
  }
}

export function parseAnyBackupPayload(
  rawInput: unknown,
  passphrase = ''
): DatabaseState {
  let parsed: unknown = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim().replace(/^\uFEFF/, '');
    if (!trimmed) {
      throw new Error('Backup JSON content is empty.');
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid JSON file. Please upload a valid KAKAROT backup .json file.');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid backup JSON structure.');
  }

  const obj = parsed as Record<string, unknown>;
  let candidate: Partial<DatabaseState>;

  if (obj.format === 'kakarot-glory-pro-backup-v1') {
    if (!passphrase.trim()) {
      throw new BackupPassphraseRequiredError();
    }
    candidate = decryptAndValidateBackup(obj, passphrase);
  } else if (
    obj.format === 'kakarot-glory-pro-plain-backup-v1' &&
    obj.state &&
    typeof obj.state === 'object'
  ) {
    candidate = obj.state as Partial<DatabaseState>;
  } else {
    candidate = obj as Partial<DatabaseState>;
  }

  if (!candidate.settings || !Array.isArray(candidate.users)) {
    throw new Error(
      'Uploaded JSON does not contain KAKAROT website settings and users. Please select a valid backup JSON.'
    );
  }

  const now = new Date().toISOString();
  const normalized: DatabaseState = {
    settings: {
      websiteName: candidate.settings.websiteName || 'KAKAROT GLORY PRO',
      websiteLogo: candidate.settings.websiteLogo || '',
      websiteTitle: candidate.settings.websiteTitle || 'KAKAROT GLORY PRO',
      websiteDescription:
        candidate.settings.websiteDescription ||
        'KAKAROT GLORY PRO — Automated Clan Glory Group Management, Credits, Coupons & Admin Control Panel.',
      websiteAnnouncement: candidate.settings.websiteAnnouncement || '',
      registrationEnabled: candidate.settings.registrationEnabled !== false,
      maintenanceMode: Boolean(candidate.settings.maintenanceMode),
      websiteNotificationsEnabled: candidate.settings.websiteNotificationsEnabled !== false,
      updatedAt: candidate.settings.updatedAt || now,
      updatedBy: candidate.settings.updatedBy || 'admin_super_1',
    },
    apiConfig: {
      baseUrl: candidate.apiConfig?.baseUrl || 'https://ffglory.pro',
      masterKey: candidate.apiConfig?.masterKey || '',
      apiKey: candidate.apiConfig?.apiKey || '',
      providerUsername: candidate.apiConfig?.providerUsername || '',
      providerPassword: candidate.apiConfig?.providerPassword || '',
      lastTestedAt: candidate.apiConfig?.lastTestedAt,
      lastStatus:
        candidate.apiConfig?.lastStatus ||
        (candidate.apiConfig?.apiKey && candidate.apiConfig?.masterKey ? 'connected' : 'unconfigured'),
      lastMessage:
        candidate.apiConfig?.lastMessage ||
        (candidate.apiConfig?.apiKey ? 'Restored from backup JSON' : 'Provider API keys not configured yet'),
    },
    famwiseConfig: {
      baseUrl: candidate.famwiseConfig?.baseUrl || 'https://famwise.co',
      apiKey: candidate.famwiseConfig?.apiKey || '',
      upiId: candidate.famwiseConfig?.upiId || '',
      webhookSecret: candidate.famwiseConfig?.webhookSecret || '',
      basicCreditInr:
        typeof candidate.famwiseConfig?.basicCreditInr === 'number' &&
        candidate.famwiseConfig.basicCreditInr >= 1
          ? candidate.famwiseConfig.basicCreditInr
          : 80,
      premiumCreditInr:
        typeof candidate.famwiseConfig?.premiumCreditInr === 'number' &&
        candidate.famwiseConfig.premiumCreditInr >= 1
          ? candidate.famwiseConfig.premiumCreditInr
          : 160,
      lastTestedAt: candidate.famwiseConfig?.lastTestedAt,
      lastStatus:
        candidate.famwiseConfig?.lastStatus ||
        (candidate.famwiseConfig?.apiKey ? 'connected' : 'unconfigured'),
      lastMessage: candidate.famwiseConfig?.lastMessage || '',
    },
    youtubeConfig: {
      apiKey: candidate.youtubeConfig?.apiKey || '',
      lastCheckedAt: candidate.youtubeConfig?.lastCheckedAt,
      lastMessage: candidate.youtubeConfig?.lastMessage || '',
    },
    adminSetupRequired: false,
    adminEnvKeyFingerprint: candidate.adminEnvKeyFingerprint,
    users: Array.isArray(candidate.users) ? candidate.users : [],
    groups: Array.isArray(candidate.groups) ? candidate.groups : [],
    transactions: Array.isArray(candidate.transactions) ? candidate.transactions : [],
    deposits: Array.isArray(candidate.deposits) ? candidate.deposits : [],
    creditedDepositOrderIds: Array.isArray(candidate.creditedDepositOrderIds)
      ? candidate.creditedDepositOrderIds
      : [],
    creditAudits: Array.isArray(candidate.creditAudits) ? candidate.creditAudits : [],
    processedOperationIds: Array.isArray(candidate.processedOperationIds)
      ? candidate.processedOperationIds
      : [],
    coupons: Array.isArray(candidate.coupons) ? candidate.coupons : [],
    youtubeVideos: Array.isArray(candidate.youtubeVideos) ? candidate.youtubeVideos : [],
    activityLogs: Array.isArray(candidate.activityLogs) ? candidate.activityLogs : [],
    notifications: Array.isArray(candidate.notifications) ? candidate.notifications : [],
    apiLogs: Array.isArray(candidate.apiLogs) ? candidate.apiLogs : [],
    sessionSecret: candidate.sessionSecret || '',
  };

  return normalized;
}

function escapeEnvValue(val: string): string {
  const cleaned = val.replace(/\r?\n/g, '');
  return JSON.stringify(cleaned);
}

export function buildHostDeploymentEnvText(state: DatabaseState): {
  envText: string;
  configuredKeys: string[];
  missingKeys: string[];
} {
  const superAdmin = state.users.find((u) => u.id === 'admin_super_1' && u.role === 'admin');
  const pairs: Array<[string, string]> = [
    ['PROVIDER_API_URL', state.apiConfig?.baseUrl || 'https://ffglory.pro'],
    ['PROVIDER_API_KEY', state.apiConfig?.apiKey || ''],
    ['PROVIDER_MASTER_KEY', state.apiConfig?.masterKey || ''],
    ['PROVIDER_USERNAME', state.apiConfig?.providerUsername || ''],
    ['PROVIDER_PASSWORD', state.apiConfig?.providerPassword || ''],
    ['FAMWISE_BASE_URL', state.famwiseConfig?.baseUrl || 'https://famwise.co'],
    ['FAMWISE_API_KEY', state.famwiseConfig?.apiKey || ''],
    ['FAMWISE_UPI_ID', state.famwiseConfig?.upiId || ''],
    ['FAMWISE_WEBHOOK_SECRET', state.famwiseConfig?.webhookSecret || ''],
    ['ADMIN_USERNAME', process.env.ADMIN_USERNAME || superAdmin?.username || 'harshverma5708'],
    ['ADMIN_EMAIL', process.env.ADMIN_EMAIL || superAdmin?.email || 'ffharsh813@gmail.com'],
    ['ADMIN_ACCESS_KEY', process.env.ADMIN_ACCESS_KEY || ''],
    ['YOUTUBE_API_KEY', state.youtubeConfig?.apiKey || process.env.YOUTUBE_API_KEY || ''],
    ['SESSION_SECRET', state.sessionSecret || ''],
  ];

  const lines: string[] = [];
  const configuredKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const [k, rawVal] of pairs) {
    const val = (rawVal || '').trim();
    if (val) {
      lines.push(`${k}=${escapeEnvValue(val)}`);
      configuredKeys.push(k);
    } else {
      missingKeys.push(k);
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    lines.push(
      `FIREBASE_SERVICE_ACCOUNT_JSON=${escapeEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim())}`
    );
    configuredKeys.push('FIREBASE_SERVICE_ACCOUNT_JSON');
  } else {
    missingKeys.push('FIREBASE_SERVICE_ACCOUNT_JSON');
  }

  return {
    envText: lines.join('\n'),
    configuredKeys,
    missingKeys,
  };
}
