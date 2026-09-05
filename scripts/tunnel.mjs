/**
 * Starts a cloudflared quick tunnel in front of the dev server, and wires the
 * desktop app to it automatically.
 *
 * The cross-network test used to mean: start the tunnel, find the URL in the
 * log, convert https to wss, append /ws, paste it into a .env file, rebuild.
 * Every time — because a quick tunnel gets a new hostname on each run. That is
 * enough friction to make the one test that actually matters get skipped.
 *
 * Run: pnpm tunnel   (leave it running, then `pnpm dev` in another terminal)
 */

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const urlFile = join(root, '.tunnel-url');
const PORT = process.env['TUNNEL_PORT'] ?? '5173';

// Forward slashes on purpose: Node accepts them on Windows, and they survive
// every layer of shell and heredoc escaping in between.
const WINDOWS_FALLBACKS = [
  'C:/Program Files (x86)/cloudflared/cloudflared.exe',
  'C:/Program Files/cloudflared/cloudflared.exe',
];

function resolveBinary() {
  if (process.platform === 'win32') {
    // A freshly installed cloudflared is not on PATH in terminals that were
    // already open, which is exactly when someone first tries this.
    const found = WINDOWS_FALLBACKS.find((candidate) => existsSync(candidate));
    if (found !== undefined) return found;
  }
  return 'cloudflared';
}

const child = spawn(resolveBinary(), ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('cloudflared is not installed, or not on PATH.\n');
    console.error(
      process.platform === 'darwin'
        ? '  brew install cloudflared'
        : '  winget install --id Cloudflare.cloudflared',
    );
    console.error('\nOpen a NEW terminal afterwards so PATH is picked up.');
    process.exit(1);
  }
  throw err;
});

let announced = false;

function onLine(line) {
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line);
  if (match === null || announced) return;
  announced = true;

  const httpsUrl = match[0];
  const wssUrl = `${httpsUrl.replace(/^https:/, 'wss:')}/ws`;
  writeFileSync(urlFile, `${wssUrl}\n`, 'utf8');

  const bar = '='.repeat(Math.max(httpsUrl.length + 22, 56));
  console.log(`\n${bar}`);
  console.log('  Tunnel is up.\n');
  console.log(`  Open this on your phone:  ${httpsUrl}`);
  console.log('  Turn Wi-Fi OFF first, so it is on mobile data.\n');
  console.log(`  Desktop app will use:     ${wssUrl}`);
  console.log('  (written to .tunnel-url — no rebuild, no file to edit)\n');
  console.log('  Now run `pnpm dev` in another terminal.');
  console.log('  Leave this running; Ctrl+C here takes the tunnel down.');
  console.log(`${bar}\n`);
}

for (const stream of [child.stdout, child.stderr]) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
}

function cleanup() {
  // Leaving a stale URL behind would silently point the next local run at a
  // tunnel that no longer exists.
  try {
    unlinkSync(urlFile);
  } catch {
    /* already gone */
  }
}

process.on('SIGINT', () => {
  cleanup();
  child.kill('SIGINT');
  process.exit(0);
});

child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
