import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { createApp } from './app.ts';
import { hashPassword } from './auth.ts';
import {
  loadState,
  parseServiceAccountJson,
  validateServiceAccountPrivateKey,
} from './store.ts';
import { extractYouTubeVideoId, fetchYouTubeVideoMetadata } from './youtube.ts';

test('extractYouTubeVideoId parses watch, youtu.be, shorts, embed, and raw IDs accurately', () => {
  assert.equal(extractYouTubeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share'),
    'dQw4w9WgXcQ'
  );
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=test'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://example.com/not-youtube'), null);
  assert.equal(extractYouTubeVideoId(''), null);
});

test('fetchYouTubeVideoMetadata flags missingApiKey when YOUTUBE_API_KEY is absent', async () => {
  const res = await fetchYouTubeVideoMetadata('https://youtu.be/dQw4w9WgXcQ', '');
  assert.equal(res.ok, false);
  assert.equal(res.missingApiKey, true);
});

test('Admin setup-status exposes no username hints, rejects wrong keys, and accepts key-only login', async () => {
  const state = await loadState();
  const admin = state.users.find((u) => u.role === 'admin');
  assert.ok(admin, 'Super admin record must exist');
  const originalHash = admin.passwordHash;
  const envKey = (process.env.ADMIN_ACCESS_KEY || '').trim();
  const testKey = envKey || 'ephemeral-test-admin-key-123';
  if (!envKey) {
    admin.passwordHash = hashPassword(testKey);
  }

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    const statusRes = await fetch(`${base}/api/admin/setup-status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as Record<string, unknown>;
    assert.equal('defaultUsername' in statusJson, false);
    assert.equal(statusJson.setupRequired, false);

    const adminUser = process.env.ADMIN_USERNAME || 'harshverma5708';

    const badLogin = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-invalid-key' }),
    });
    assert.equal(badLogin.status, 401);

    const emptyLogin = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(emptyLogin.status, 400);

    // Key-only admin login (no username required)
    const keyOnlyLogin = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: testKey }),
    });
    assert.equal(keyOnlyLogin.status, 200);
    const okData = (await keyOnlyLogin.json()) as { token?: string; admin?: { username?: string } };
    assert.ok(okData.token);
    assert.equal(okData.admin?.username, adminUser);

    const txnsRes = await fetch(`${base}/api/admin/transactions`, {
      headers: { 'x-admin-token': okData.token },
    });
    assert.equal(txnsRes.status, 200);
    const txnsData = await txnsRes.json();
    assert.equal(Array.isArray(txnsData), true);

    const ytRes = await fetch(`${base}/api/admin/youtube`, {
      headers: { 'x-admin-token': okData.token },
    });
    assert.equal(ytRes.status, 200);

    const logsRes = await fetch(`${base}/api/admin/logs`, {
      headers: { 'x-admin-token': okData.token },
    });
    assert.equal(logsRes.status, 200);
  } finally {
    admin.passwordHash = originalHash;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

test('Express backend serves settings, signup/login, key-only admin login, SSE stream, and binary Source Code ZIP cleanly', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'kakarot_db.json');
  const dbBackup = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  const state = await loadState();
  const admin = state.users.find((u) => u.role === 'admin');
  assert.ok(admin);
  const originalHash = admin.passwordHash;
  const envKey = (process.env.ADMIN_ACCESS_KEY || '').trim();
  const testKey = envKey || 'ephemeral-test-admin-key-123';
  if (!envKey) {
    admin.passwordHash = hashPassword(testKey);
  }

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    const settingsRes = await fetch(`${base}/api/public/settings`);
    assert.equal(settingsRes.status, 200);
    const settingsJson = (await settingsRes.json()) as {
      websiteName?: string;
      registrationEnabled?: boolean;
    };
    assert.equal(settingsJson.websiteName, 'KAKAROT GLORY PRO');
    assert.equal(settingsJson.registrationEnabled, true);

    const testUser = `verify_${Date.now().toString().slice(-6)}`;
    const signupRes = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUser,
        email: `${testUser}@example.com`,
        password: 'password123',
      }),
    });
    assert.equal(signupRes.status, 201);
    const signupJson = (await signupRes.json()) as { token?: string; user?: { username?: string } };
    assert.ok(signupJson.token);
    assert.equal(signupJson.user?.username, testUser);

    const userLoginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUser,
        password: 'password123',
      }),
    });
    assert.equal(userLoginRes.status, 200);

    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: testKey }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { token: string };
    assert.ok(loginData.token);

    const zipRes = await fetch(`${base}/api/admin/download-source-zip`, {
      headers: { 'x-admin-token': loginData.token },
    });
    assert.equal(zipRes.status, 200);
    assert.equal(zipRes.headers.get('content-type'), 'application/zip');
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    const archive = await JSZip.loadAsync(zipBuf);
    const zipFiles = Object.keys(archive.files);
    assert.ok(zipFiles.includes('server.ts'));
    assert.ok(zipFiles.includes('README.txt'));
    assert.equal(zipFiles.includes('netlify.toml'), false);

    // Persistent SSE /api/public/events emits settings and youtube events immediately
    const sseController = new AbortController();
    const sseRes = await fetch(`${base}/api/public/events`, {
      signal: sseController.signal,
    });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body?.getReader();
    assert.ok(reader);
    const { value } = await reader.read();
    const firstChunk = new TextDecoder().decode(value);
    sseController.abort();
    assert.ok(firstChunk.includes('event: settings'));
  } finally {
    admin.passwordHash = originalHash;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup, 'utf8');
    }
  }
});

test('Frontend source files never contain hardcoded admin access keys or credential hints', () => {
  const adminPanelSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/AdminPanel.tsx'),
    'utf8'
  );
  assert.equal(adminPanelSrc.includes('harsh@8089'), false);
  assert.equal(adminPanelSrc.includes('harsh@8080'), false);
  assert.equal(adminPanelSrc.includes('harshverma5708'), false);
  assert.equal(adminPanelSrc.includes('kakarot_files'), false);
  assert.equal(adminPanelSrc.includes('defaultUsername'), false);
  assert.equal(adminPanelSrc.toLowerCase().includes('netlify'), false);

  const firebaseCfg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8')
  ) as { projectId?: string; authDomain?: string };
  assert.equal(firebaseCfg.projectId, 'ffglorypro-da224');
  assert.equal(firebaseCfg.authDomain, 'ffglorypro-da224.firebaseapp.com');
});

test('parseServiceAccountJson & validateServiceAccountPrivateKey handle quotes, double-escaping, flattened PEMs, and corrupt keys cleanly', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  // 1) Flattened space-separated PEM inside single-quoted JSON + escaped \\n
  const flattenedPem = String(privateKey).replace(/\n+/g, ' ').trim();
  const sample = {
    type: 'service_account',
    project_id: 'ffglorypro-da224',
    client_email: 'test@ffglorypro-da224.iam.gserviceaccount.com',
    private_key: flattenedPem,
  };
  const singleQuoted = `'${JSON.stringify(sample)}'`;
  const doubleEncoded = JSON.stringify(JSON.stringify(sample));

  const parsed1 = parseServiceAccountJson(singleQuoted);
  assert.ok(parsed1);
  assert.equal(parsed1.project_id, 'ffglorypro-da224');
  assert.equal(validateServiceAccountPrivateKey(parsed1.private_key), true);

  const parsed2 = parseServiceAccountJson(doubleEncoded);
  assert.ok(parsed2);
  assert.equal(parsed2.client_email, sample.client_email);
  assert.equal(validateServiceAccountPrivateKey(parsed2.private_key), true);

  // 2) Truncated / malformed PEM returns false instead of throwing
  assert.equal(validateServiceAccountPrivateKey('-----BEGIN PRIVATE KEY-----\nBROKEN\n-----END PRIVATE KEY-----\n'), false);
  assert.equal(parseServiceAccountJson('not-valid-json'), null);
});

test('Glory progression returns structured snapshots, manual user refund is disabled, and admin refund works without duplicates', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'kakarot_db.json');
  const dbBackup = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  const state = await loadState();
  const admin = state.users.find((u) => u.role === 'admin');
  assert.ok(admin);
  const originalHash = admin.passwordHash;
  const envKey = (process.env.ADMIN_ACCESS_KEY || '').trim();
  const testKey = envKey || 'ephemeral-test-admin-key-123';
  if (!envKey) {
    admin.passwordHash = hashPassword(testKey);
  }

  // Temporarily disable upstream API calls inside this offline test
  const origApiKey = state.apiConfig.apiKey;
  const origMasterKey = state.apiConfig.masterKey;
  state.apiConfig.apiKey = '';
  state.apiConfig.masterKey = '';

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const gloryGroupId = `grp_test_glory_${Date.now()}`;

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    const uname = `refund_u_${Date.now().toString().slice(-6)}`;
    const signupRes = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: uname,
        email: `${uname}@example.com`,
        password: 'password123',
      }),
    });
    assert.equal(signupRes.status, 201);
    const { token: userToken, user: createdUser } = (await signupRes.json()) as {
      token: string;
      user: { id: string; basicCredits: number };
    };

    const now = new Date().toISOString();
    state.groups.unshift({
      group_id: gloryGroupId,
      userId: createdUser.id,
      username: uname,
      clan_id: '3056433229',
      region: 'IND',
      region_name: 'India',
      tier: 'basic',
      status: 'stopped',
      container_count: 4,
      running_count: 0,
      glory_farmed: 29184,
      games_played: 53,
      uptime: '1h17m0s',
      archived: false,
      created_at: now,
      updated_at: now,
      glory_details: [
        { account_id: 'bot1', nickname: 'Bot-1', glory: 7296, level: 2, credit_score: 100 },
      ],
      glory_snapshots: [{ captured_at: now, total_glory: 29184, uptime_hours: 1.28 }],
    });

    // 1) Glory progression endpoint returns structured snapshots & bot details
    const progRes = await fetch(
      `${base}/api/client/glory-progression?group_id=${encodeURIComponent(gloryGroupId)}`,
      { headers: { Authorization: `Bearer ${userToken}` } }
    );
    assert.equal(progRes.status, 200);
    const progJson = (await progRes.json()) as {
      glory_farmed: number;
      games_played: number;
      snapshots: unknown[];
      glory_details: unknown[];
    };
    assert.equal(progJson.glory_farmed, 29184);
    assert.equal(progJson.games_played, 53);
    assert.equal(progJson.snapshots.length, 1);
    assert.equal(progJson.glory_details.length, 1);

    // 2) Manual client refund action is disabled (400 Unsupported action)
    const manualRefundRes = await fetch(`${base}/api/client/group-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ action: 'refund', group_id: gloryGroupId }),
    });
    assert.equal(manualRefundRes.status, 400);

    // 3) Admin refund completes once and rejects duplicates
    const adminLoginRes = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: testKey }),
    });
    assert.equal(adminLoginRes.status, 200);
    const { token: adminToken } = (await adminLoginRes.json()) as { token: string };

    const adminRefundRes = await fetch(`${base}/api/admin/groups/${gloryGroupId}/refund`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
    });
    assert.equal(adminRefundRes.status, 200);
    const adminRefundJson = (await adminRefundRes.json()) as {
      user?: { basicCredits: number };
      group?: { status: string; refunded?: boolean };
    };
    assert.equal(adminRefundJson.user?.basicCredits, 1);
    assert.equal(adminRefundJson.group?.status, 'refunded');
    assert.equal(adminRefundJson.group?.refunded, true);

    const adminDupRes = await fetch(`${base}/api/admin/groups/${gloryGroupId}/refund`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
    });
    assert.equal(adminDupRes.status, 409);
  } finally {
    admin.passwordHash = originalHash;
    state.apiConfig.apiKey = origApiKey;
    state.apiConfig.masterKey = origMasterKey;
    state.groups = state.groups.filter((g) => g.group_id !== gloryGroupId);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup, 'utf8');
    }
  }
});

test('Pricing returns basic_credit_inr & premium_credit_inr, extend action checks credits and eligibility, and i18n covers 11 languages', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'kakarot_db.json');
  const dbBackup = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  const state = await loadState();

  const origApiKey = state.apiConfig.apiKey;
  const origMasterKey = state.apiConfig.masterKey;
  state.apiConfig.apiKey = '';
  state.apiConfig.masterKey = '';

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const grpNoExtend = `grp_no_ext_${Date.now()}`;
  const grpNeedCredit = `grp_need_cred_${Date.now()}`;

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    // 1) Pricing returns INR credit prices
    const pricingRes = await fetch(`${base}/api/pricing`);
    assert.equal(pricingRes.status, 200);
    const pricingJson = (await pricingRes.json()) as {
      basic_credit_inr?: number;
      premium_credit_inr?: number;
    };
    assert.equal(typeof pricingJson.basic_credit_inr, 'number');
    assert.equal(typeof pricingJson.premium_credit_inr, 'number');
    assert.ok((pricingJson.basic_credit_inr ?? 0) > 0);

    // 2) Create user & seed 2 deleted groups (one non-extendable, one needing 1 credit)
    const uname = `extend_u_${Date.now().toString().slice(-6)}`;
    const signupRes = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: uname,
        email: `${uname}@example.com`,
        password: 'password123',
      }),
    });
    assert.equal(signupRes.status, 201);
    const { token: userToken, user: createdUser } = (await signupRes.json()) as {
      token: string;
      user: { id: string; basicCredits: number };
    };

    const now = new Date().toISOString();
    state.groups.unshift(
      {
        group_id: grpNoExtend,
        userId: createdUser.id,
        username: uname,
        clan_id: '3056433229',
        region: 'IND',
        region_name: 'India',
        tier: 'basic',
        status: 'deleted',
        container_count: 4,
        running_count: 0,
        glory_farmed: 0,
        games_played: 0,
        uptime: '8h0m0s',
        archived: true,
        can_extend: false,
        extend_count: 0,
        max_extends: 1,
        created_at: now,
        updated_at: now,
      },
      {
        group_id: grpNeedCredit,
        userId: createdUser.id,
        username: uname,
        clan_id: '3056433229',
        region: 'IND',
        region_name: 'India',
        tier: 'basic',
        status: 'deleted',
        container_count: 4,
        running_count: 0,
        glory_farmed: 5000,
        games_played: 10,
        uptime: '8h0m0s',
        archived: true,
        can_extend: true,
        extend_count: 0,
        max_extends: 1,
        created_at: now,
        updated_at: now,
      }
    );

    // 3) Rejects non-extendable group with 400
    const noExtRes = await fetch(`${base}/api/client/group-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ action: 'extend', group_id: grpNoExtend }),
    });
    assert.equal(noExtRes.status, 400);

    // 4) Rejects when user has 0 credits with 402 without mutating credits
    const zeroCredRes = await fetch(`${base}/api/client/group-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ action: 'extend', group_id: grpNeedCredit }),
    });
    assert.equal(zeroCredRes.status, 402);

    // 5) i18n file contains all 11 supported languages
    const i18nSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/i18n.tsx'), 'utf8');
    for (const code of ['en', 'hi', 'bn', 'id', 'ar', 'vi', 'ur', 'es', 'pt', 'ru', 'th']) {
      assert.ok(i18nSrc.includes(`code: '${code}'`), `Missing language option ${code}`);
    }
  } finally {
    state.apiConfig.apiKey = origApiKey;
    state.apiConfig.masterKey = origMasterKey;
    state.groups = state.groups.filter(
      (g) => g.group_id !== grpNoExtend && g.group_id !== grpNeedCredit
    );
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup, 'utf8');
    }
  }
});

test('Admin JSON backup export, encrypted backup, .env export, and JSON upload restore recover providers and data cleanly', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'kakarot_db.json');
  const dbBackup = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  const state = await loadState();
  const snapshotBefore = JSON.parse(JSON.stringify(state)) as typeof state;

  const admin = state.users.find((u) => u.role === 'admin');
  assert.ok(admin);
  const envKey = (process.env.ADMIN_ACCESS_KEY || '').trim();
  const testKey = envKey || 'ephemeral-test-admin-key-123';
  if (!envKey) {
    admin.passwordHash = hashPassword(testKey);
  }

  state.apiConfig.apiKey = 'test_provider_api_key_abc';
  state.apiConfig.masterKey = 'test_provider_master_key_xyz';
  state.famwiseConfig.apiKey = 'fw_test_key_123';

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: testKey }),
    });
    assert.equal(loginRes.status, 200);
    const { token: adminToken } = (await loginRes.json()) as { token: string };

    // 1) Export Plain Backup JSON
    const exportRes = await fetch(`${base}/api/admin/backup/export-json`, {
      headers: { 'x-admin-token': adminToken },
    });
    assert.equal(exportRes.status, 200);
    const plainJsonText = await exportRes.text();
    const parsedExport = JSON.parse(plainJsonText) as {
      format: string;
      stats: { hasProviderKeys: boolean; hasFamwiseKey: boolean };
    };
    assert.equal(parsedExport.format, 'kakarot-glory-pro-plain-backup-v1');
    assert.equal(parsedExport.stats.hasProviderKeys, true);
    assert.equal(parsedExport.stats.hasFamwiseKey, true);

    // 2) Export Encrypted Backup JSON
    const encRes = await fetch(`${base}/api/admin/backup/export-encrypted`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken,
      },
      body: JSON.stringify({ passphrase: 'secret-passphrase-99' }),
    });
    assert.equal(encRes.status, 200);
    const encJsonText = await encRes.text();

    // 3) Export .env text
    const envRes = await fetch(`${base}/api/admin/backup/export-env`, {
      headers: { 'x-admin-token': adminToken },
    });
    assert.equal(envRes.status, 200);
    const envJson = (await envRes.json()) as { envText: string; configuredKeys: string[] };
    assert.ok(envJson.configuredKeys.includes('PROVIDER_API_KEY'));
    assert.ok(envJson.envText.includes('PROVIDER_API_KEY='));

    // 4) Wipe provider credentials in live state (simulating clean fresh host)
    state.apiConfig.apiKey = '';
    state.apiConfig.masterKey = '';
    state.famwiseConfig.apiKey = '';

    // Encrypted JSON without passphrase returns 400 + requiresPassphrase: true
    const noPassImport = await fetch(`${base}/api/admin/backup/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken,
      },
      body: JSON.stringify({ payload: encJsonText }),
    });
    assert.equal(noPassImport.status, 400);
    const noPassBody = (await noPassImport.json()) as { requiresPassphrase?: boolean };
    assert.equal(noPassBody.requiresPassphrase, true);

    // 5) Restore via plain JSON upload (without losing active admin session)
    const restoreRes = await fetch(`${base}/api/admin/backup/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken,
      },
      body: JSON.stringify({ payload: plainJsonText }),
    });
    assert.equal(restoreRes.status, 200);
    const restoreJson = (await restoreRes.json()) as {
      success: boolean;
      restored: { hasProviderKeys: boolean; hasFamwiseKey: boolean };
    };
    assert.equal(restoreJson.success, true);
    assert.equal(restoreJson.restored.hasProviderKeys, true);
    assert.equal(restoreJson.restored.hasFamwiseKey, true);
    assert.equal(state.apiConfig.apiKey, 'test_provider_api_key_abc');
    assert.equal(state.famwiseConfig.apiKey, 'fw_test_key_123');

    // Admin token remains valid after restore
    const meAfter = await fetch(`${base}/api/admin/me`, {
      headers: { 'x-admin-token': adminToken },
    });
    assert.equal(meAfter.status, 200);
  } finally {
    Object.assign(state, snapshotBefore);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup, 'utf8');
    }
  }
});

test('Admin login tolerates pasted whitespace, falls back from stale header to valid cookie, and skips Secure over plain HTTP', async () => {
  const dbPath = path.join(process.cwd(), 'data', 'kakarot_db.json');
  const dbBackup = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : null;
  const state = await loadState();
  const admin = state.users.find((u) => u.role === 'admin');
  assert.ok(admin);
  const originalHash = admin.passwordHash;
  const originalEnvKey = process.env.ADMIN_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const testKey = (process.env.ADMIN_ACCESS_KEY || '').trim() || 'ephemeral-test-admin-key-123';
  if (!process.env.ADMIN_ACCESS_KEY?.trim()) {
    admin.passwordHash = hashPassword(testKey);
  }

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    process.env.NODE_ENV = 'production';
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;

    // Pasted key with leading/trailing spaces works cleanly and HTTP cookie does NOT force Secure
    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: `  ${testKey}  ` }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('kakarot_admin_token='));
    assert.equal(setCookie.toLowerCase().includes('; secure'), false);

    const cookiePair = setCookie.split(';')[0];

    // Stale x-admin-token header does NOT block a valid session cookie
    const meRes = await fetch(`${base}/api/admin/me`, {
      headers: {
        'x-admin-token': 'stale.invalid.token',
        cookie: cookiePair,
      },
    });
    assert.equal(meRes.status, 200);
    const meJson = (await meRes.json()) as { admin?: { role?: string } };
    assert.equal(meJson.admin?.role, 'admin');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnvKey === undefined) delete process.env.ADMIN_ACCESS_KEY;
    else process.env.ADMIN_ACCESS_KEY = originalEnvKey;
    admin.passwordHash = originalHash;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    if (dbBackup !== null) {
      fs.writeFileSync(dbPath, dbBackup, 'utf8');
    }
  }
});
