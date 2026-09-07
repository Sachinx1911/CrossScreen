/**
 * Copies the Cloudflare TURN key into `services/api/.env.local`, where the
 * API service now mints its own short-lived credentials per request
 * (services/api/src/turn.ts, ADR-0004).
 *
 * Phase 0.5 discovered the hard way that TURN is not optional: a PC and a
 * phone on mobile data could not find a direct path at all, and with no relay
 * configured the connection simply failed. Mobile carriers put subscribers
 * behind CGNAT, so this is the normal case rather than bad luck.
 *
 * This script used to fetch a credential from Cloudflare itself and write it
 * out — a manual, 24-hour-lived stand-in for what §2.1 wanted. Now that
 * `GET /api/v1/ice-servers` does that fetching itself, on every request that
 * needs it, this script's job shrinks to the one-time setup step: getting the
 * long-term key from where it is created into where it is used. The key
 * itself still never reaches a client — only what the service mints from it.
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
const TARGET = 'services/api';

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

/** Replace the CLOUDFLARE_TURN_* lines in a .env.local, leaving everything else. */
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

writeEnv(TARGET, {
  CLOUDFLARE_TURN_KEY_ID: keyId,
  CLOUDFLARE_TURN_API_TOKEN: apiToken,
});

console.log('\nThe API service mints its own short-lived credential from this key on');
console.log('every GET /api/v1/ice-servers call — nothing further to fetch here.');
console.log('\nRestart `pnpm dev` so the api service picks up the key.');
console.log('To prove the relay path specifically:');
console.log('  browser:  add ?relay=1 to the share or viewer URL');
console.log('  desktop:  set VITE_FORCE_RELAY=1 in apps/desktop/.env.local and restart');
