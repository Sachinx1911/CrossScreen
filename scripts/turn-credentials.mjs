/**
 * Fetches short-lived TURN credentials from Cloudflare and writes them into
 * the apps' .env.local files.
 *
 * Phase 0.5 discovered the hard way that TURN is not optional: a PC and a
 * phone on mobile data could not find a direct path at all, and with no relay
 * configured the connection simply failed. Mobile carriers put subscribers
 * behind CGNAT, so this is the normal case rather than bad luck.
 *
 * The long-term secret stays on this machine. This script is a stand-in for
 * the `GET /api/v1/ice-servers` endpoint that Phase 2 builds — same shape,
 * same short TTL, so no client ever ships a long-lived credential (ADR-0004).
 *
 * Setup, once:
 *   1. dash.cloudflare.com  ->  Realtime  ->  TURN Keys  ->  Create
 *   2. Put the two values in `.env.turn` at the repository root:
 *
 *        CLOUDFLARE_TURN_KEY_ID=...
 *        CLOUDFLARE_TURN_API_TOKEN=...
 *
 *      That file is gitignored. Do not paste the token anywhere else.
 *
 * Run: pnpm turn
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS_FILE = join(root, '.env.turn');
const TTL_SECONDS = 86_400;
const TARGETS = ['apps/web', 'apps/desktop'];

function readSecrets() {
  const values = { ...process.env };

  if (existsSync(SECRETS_FILE)) {
    for (const line of readFileSync(SECRETS_FILE, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }

  const keyId = values['CLOUDFLARE_TURN_KEY_ID'];
  const apiToken = values['CLOUDFLARE_TURN_API_TOKEN'];

  if (!keyId || !apiToken) {
    console.error('Missing Cloudflare TURN credentials.\n');
    console.error(`Create ${SECRETS_FILE} containing:\n`);
    console.error('  CLOUDFLARE_TURN_KEY_ID=...');
    console.error('  CLOUDFLARE_TURN_API_TOKEN=...\n');
    console.error('Get both from dash.cloudflare.com -> Realtime -> TURN Keys.');
    console.error('That file is gitignored; the token must not go anywhere else.');
    process.exit(1);
  }

  return { keyId, apiToken };
}

/** Replace the VITE_TURN_* lines in a .env.local, leaving everything else. */
function writeEnv(dir, entries) {
  const file = join(root, dir, '.env.local');
  const managed = new Set(Object.keys(entries));

  const kept = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => {
          const key = line.split('=')[0]?.trim();
          return key === undefined || !managed.has(key);
        })
        .join('\n')
        .trimEnd()
    : '';

  const block = Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  writeFileSync(file, `${kept}\n${block}\n`.replace(/^\n/, ''), 'utf8');
  console.log(`  updated ${dir}/.env.local`);
}

const { keyId, apiToken } = readSecrets();

const response = await fetch(
  `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  },
);

if (!response.ok) {
  const body = await response.text();
  console.error(`Cloudflare refused the request (HTTP ${response.status}).\n`);
  // The body can echo request details; the token itself is never in it.
  console.error(body.slice(0, 500));
  if (response.status === 401 || response.status === 403) {
    console.error('\nCheck the key ID and API token in .env.turn.');
  }
  process.exit(1);
}

const { iceServers } = await response.json();
const servers = Array.isArray(iceServers) ? iceServers : [iceServers];

const urls = servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).filter(Boolean);
const withCredentials = servers.find((s) => s.username && s.credential);

if (withCredentials === undefined) {
  console.error('Cloudflare returned no credentialed TURN server.');
  process.exit(1);
}

const turnUrls = urls.filter((u) => u.startsWith('turn:') || u.startsWith('turns:'));

console.log('TURN credentials issued.\n');
console.log(`  valid for:  ${TTL_SECONDS / 3600} hours`);
console.log(`  urls:       ${turnUrls.join('\n              ')}\n`);

for (const dir of TARGETS) {
  writeEnv(dir, {
    VITE_TURN_URLS: turnUrls.join(','),
    VITE_TURN_USERNAME: withCredentials.username,
    VITE_TURN_CREDENTIAL: withCredentials.credential,
  });
}

console.log('\nRestart `pnpm dev` so the new values are picked up.');
console.log('To prove the relay path specifically, add ?relay=1 to the viewer URL.');
