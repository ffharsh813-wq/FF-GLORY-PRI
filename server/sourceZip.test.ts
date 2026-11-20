import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import JSZip from 'jszip';
import { createApp } from './app.ts';
import { buildSourceCodeZip } from './sourceZipService.ts';

test('buildSourceCodeZip creates a valid extractable archive without secrets or runtime DBs', async () => {
  const result = await buildSourceCodeZip(process.cwd());
  assert.ok(result.buffer.length > 1000, 'ZIP buffer should not be empty');
  assert.ok(result.fileCount > 10, 'ZIP should include project source files');

  const archive = await JSZip.loadAsync(result.buffer);
  const paths = Object.keys(archive.files);

  // Core source, config, assets, and README.txt must exist
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('index.html'));
  assert.ok(paths.includes('server.ts'));
  assert.ok(paths.includes('public/_headers'));
  assert.ok(paths.includes('firebase-applet-config.json'));
  assert.ok(paths.includes('firebase-blueprint.json'));
  assert.ok(paths.includes('firestore.rules'));
  assert.ok(paths.includes('firestore.indexes.json'));
  assert.ok(paths.includes('vite.config.ts'));
  assert.ok(paths.includes('tsconfig.json'));
  assert.ok(paths.includes('.env.example'));
  assert.ok(paths.includes('README.txt'));
  assert.ok(paths.includes('src/App.tsx'));
  assert.ok(paths.includes('src/components/AdminPanel.tsx'));
  assert.ok(paths.includes('server/app.ts'));
  assert.ok(paths.includes('server/sourceZipService.ts'));

  // Netlify, Cloudflare Workers/Pages, and Draft files must NOT appear anywhere
  assert.equal(paths.includes('netlify.toml'), false);
  assert.equal(paths.includes('public/_redirects'), false);
  assert.equal(paths.includes('wrangler.toml'), false);
  assert.equal(paths.includes('worker.ts'), false);
  assert.equal(paths.includes('.dev.vars.example'), false);
  assert.equal(paths.includes('DRAFT_firestore.rules'), false);
  assert.equal(
    paths.some((p) => p.startsWith('netlify/') || p.startsWith('functions/')),
    false
  );

  // Sensitive / excluded files must NEVER appear
  assert.equal(
    paths.some((p) => p === '.env' || (p.startsWith('.env.') && p !== '.env.example')),
    false
  );
  assert.equal(
    paths.some((p) => p === '.dev.vars' || (p.startsWith('.dev.vars.') && p !== '.dev.vars.example')),
    false
  );
  assert.equal(
    paths.some((p) => p.startsWith('data/') || p.includes('kakarot_db')),
    false
  );
  assert.equal(
    paths.some((p) => p.startsWith('node_modules/') || p.startsWith('dist/') || p.startsWith('.git/') || p.startsWith('.wrangler/')),
    false
  );
  assert.equal(
    paths.some((p) => /\.(pem|key|sqlite|db|log)$/i.test(p)),
    false
  );

  // Verify extracted contents are intact and usable for any Node.js host
  const pkgText = await archive.file('package.json')!.async('string');
  const pkgJson = JSON.parse(pkgText) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  assert.ok(pkgJson.dependencies?.jszip, 'Extracted package.json should contain jszip');
  assert.ok(pkgJson.dependencies?.express, 'Extracted package.json should contain express');
  assert.equal(pkgJson.dependencies?.['serverless-http'], undefined, 'serverless-http should be removed');
  assert.equal(pkgJson.scripts?.start, 'node server.ts');

  const readmeText = await archive.file('README.txt')!.async('string');
  assert.ok(readmeText.includes('KAKAROT GLORY PRO'));
  assert.ok(readmeText.includes('ffglorypro-da224'));
  assert.ok(readmeText.includes('UNIVERSAL PRODUCTION HOSTING'));
  assert.ok(readmeText.includes('npm start'));
  assert.equal(readmeText.toLowerCase().includes('netlify'), false);
  assert.equal(readmeText.includes('harsh@8080'), false);
  assert.equal(readmeText.includes('harsh@8089'), false);
});

test('GET /api/admin/download-source-zip rejects unauthenticated requests with 401', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/download-source-zip`);
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
