import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'data',
  '.aistudio',
  '.wrangler',
  'functions',
  '.vscode',
  '.idea',
  'tmp',
]);

function isSensitiveOrExcludedFile(fileName: string, relativePath: string): boolean {
  const lower = fileName.toLowerCase();
  const relLower = relativePath.toLowerCase();

  // Exclude all environment/secret files except safe .env.example template
  if (lower.startsWith('.env') && lower !== '.env.example') {
    return true;
  }
  if (
    lower.startsWith('.dev.vars') ||
    lower === 'wrangler.toml' ||
    lower === 'worker.ts' ||
    lower === 'draft_firestore.rules'
  ) {
    return true;
  }

  // Exclude runtime databases, credentials, private keys, and logs
  if (
    lower.endsWith('.db') ||
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3') ||
    lower.includes('kakarot_db') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.endsWith('.p12') ||
    lower.endsWith('.pfx') ||
    lower.endsWith('.jks') ||
    lower.endsWith('.log') ||
    lower === '.ds_store' ||
    lower === 'thumbs.db'
  ) {
    return true;
  }

  if (
    lower.includes('serviceaccount') ||
    lower.includes('service-account') ||
    lower.includes('-adminsdk-') ||
    relLower.startsWith('data/')
  ) {
    return true;
  }

  return false;
}

function buildReadmeTxt(fileCount: number): string {
  return `====================================================================
KAKAROT GLORY PRO — Universal Full-Stack Source Code Archive
====================================================================

Included Files : ${fileCount}
Archive Format : Standard ZIP (DEFLATE)
Security Note  : All private API keys, .env secrets, access keys,
                 session tokens, private keys, and runtime databases
                 (data/) are strictly excluded from this archive.
                 Supply them via .env or your hosting provider's
                 Environment Variables panel before starting.

--------------------------------------------------------------------
1. PREREQUISITES
--------------------------------------------------------------------
- Node.js 22.x (or 20.x+ with tsx)
- npm 10.x or newer
- Firebase CLI (optional: npm i -g firebase-tools) for Firestore rules

--------------------------------------------------------------------
2. LOCAL DEVELOPMENT SETUP
--------------------------------------------------------------------
1) Extract this ZIP archive into a folder and open a terminal there.

2) Install dependencies:
   npm install

3) Create your local environment file from the template:
   cp .env.example .env

4) Fill in your credentials inside .env:
   - PORT=3000
   - PROVIDER_API_URL=https://ffglory.pro
   - PROVIDER_API_KEY, PROVIDER_MASTER_KEY
   - PROVIDER_USERNAME, PROVIDER_PASSWORD (optional)
   - ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_ACCESS_KEY
   - YOUTUBE_API_KEY (YouTube Data API v3 key)
   - FAMWISE_BASE_URL=https://famwise.co
   - FAMWISE_API_KEY, FAMWISE_UPI_ID, FAMWISE_WEBHOOK_SECRET
   - FIREBASE_SERVICE_ACCOUNT_JSON (optional for Cloud Firestore sync)
   - SESSION_SECRET (strong random string)

   (Never commit .env or service-account JSON to git.)

5) Run in development mode (Express API + Vite SPA on port 3000):
   npm run dev

--------------------------------------------------------------------
3. UNIVERSAL PRODUCTION HOSTING (WORKS ON ANY NODE.JS HOST)
--------------------------------------------------------------------
This project uses a single unified Node.js + Express backend (server.ts)
that serves both all /api/* endpoints AND the compiled React SPA (dist/).
No platform lock-in or serverless adapters are required.

IMPORTANT: Do NOT upload this ZIP to static-only "Drag & Drop" website
uploaders (e.g. Cloudflare Pages Drag & Drop), because static-only
uploaders cannot run the Node.js Express backend (server.ts) or /api/*.
Use any Node.js hosting provider below:

Build & Start Commands (for ALL platforms):
  Install : npm install
  Build   : npm run build
  Start   : npm start        (runs: node server.ts on process.env.PORT || 3000)

A) RENDER / KOYEB / RAILWAY / FLY.IO / GOOGLE CLOUD RUN:
   - Connect repo or upload extracted source code.
   - Set Build Command: npm install && npm run build
   - Set Start Command: npm start
   - Add your .env secrets under the service Environment Variables tab.
   - Bind to process.env.PORT automatically (defaults to 3000).

B) HOSTINGER / CPANEL NODE.JS APP:
   - Upload and extract all files (including server.ts, server/, src/, package.json).
   - Select Node.js 22.x in Hostinger/cPanel Node.js Selector.
   - Run "npm install" and "npm run build" in SSH / Terminal.
   - Set Application Startup File to: server.ts (or npm start).
   - Add your Environment Variables in the Node.js App dashboard or .env file.

C) UBUNTU / DEBIAN VPS (PM2 + NGINX REVERSE PROXY + CUSTOM DOMAIN):
   1) Install Node.js 22.x and PM2:
      npm install -g pm2
   2) Build the frontend:
      npm install && npm run build
   3) Start the unified server with PM2:
      PORT=3000 NODE_ENV=production pm2 start "npm start" --name kakarot-glory-pro
      pm2 save && pm2 startup
   4) Proxy your domain to http://127.0.0.1:3000 in Nginx (enable SSE):
      location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
      }

D) QUICK MIGRATION TIP (EXPORTING YOUR CONFIG):
   - Sign in to Admin Panel -> Overview -> Permanent Backup & Env Sync.
   - Copy/Download your .env variables or download an Encrypted Backup (.json)
     to restore all users, balances, coupons, and API keys on any new host.

--------------------------------------------------------------------
4. FIREBASE (ffglorypro-da224) RULES, INDEXES & BACKUP / RESTORE
--------------------------------------------------------------------
1) Connect CLI to the existing Firebase project:
   firebase use ffglorypro-da224

2) Deploy Firestore security rules and composite indexes:
   firebase deploy --only firestore:rules,firestore:indexes

3) Export Cloud Firestore backup (Google Cloud / Firebase CLI):
   gcloud config set project ffglorypro-da224
   gcloud firestore export gs://ffglorypro-da224-backups/backup-$(date +%F)

4) Restore Cloud Firestore from backup:
   gcloud firestore import gs://ffglorypro-da224-backups/backup-YYYY-MM-DD

--------------------------------------------------------------------
5. PROJECT STRUCTURE
--------------------------------------------------------------------
- index.html                 Frontend HTML entry point
- server.ts                  Unified Node.js Express + Vite/dist server (PORT || 3000)
- firebase-applet-config.json Existing Firebase web SDK configuration
- firebase-blueprint.json    Firestore data model blueprint
- firestore.rules            Firestore security rules
- firestore.indexes.json     Firestore composite indexes
- src/                       React + TypeScript + Tailwind CSS UI
- server/                    Backend REST API, auth, Famwise, FFGlory & ZIP services
- public/                    Static assets and HTTP security headers
- package.json               Scripts & dependencies
- .env.example               Safe environment variable template
====================================================================
`;
}

export interface SourceZipResult {
  buffer: Buffer;
  fileCount: number;
  totalUncompressedBytes: number;
  includedPaths: string[];
}

export async function buildSourceCodeZip(
  rootDir: string = process.cwd()
): Promise<SourceZipResult> {
  const zip = new JSZip();
  const includedPaths: string[] = [];
  let totalUncompressedBytes = 0;

  function walkDirectory(currentDir: string, relDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walkDirectory(fullPath, relPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (isSensitiveOrExcludedFile(entry.name, relPath)) continue;

      // Avoid overwriting the generated README.txt if none exists on disk
      if (relPath === 'README.txt') continue;

      const data = fs.readFileSync(fullPath);
      totalUncompressedBytes += data.length;
      includedPaths.push(relPath);
      zip.file(relPath, data, { binary: true });
    }
  }

  walkDirectory(rootDir, '');

  const readmeContent = buildReadmeTxt(includedPaths.length + 1);
  zip.file('README.txt', readmeContent);
  includedPaths.push('README.txt');
  totalUncompressedBytes += Buffer.byteLength(readmeContent, 'utf8');

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    buffer,
    fileCount: includedPaths.length,
    totalUncompressedBytes,
    includedPaths,
  };
}
