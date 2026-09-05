/**
 * One command to make a fresh clone runnable.
 *
 * This project is developed across two machines — a Windows PC and a Mac —
 * so a clone has to reach a working state without anyone remembering a
 * sequence of steps. Three things are not in git and have to be recreated:
 * dependencies, the workspace packages' build output (ESLint's type-aware
 * rules read the generated .d.ts files), and the .env.local files.
 *
 * Run: pnpm setup
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { cwd: root, stdio: 'inherit' });
}

const ENV_TARGETS = ['apps/web', 'apps/desktop'];

console.log('CrossScreen setup\n');
console.log(`platform: ${process.platform}   node: ${process.version}`);

run('pnpm install');

// ESLint's type-aware rules resolve workspace imports through the generated
// declaration files, so linting a clone that has never been built fails with
// "could not be resolved" rather than anything informative.
run('pnpm build');

let created = 0;
for (const dir of ENV_TARGETS) {
  const example = join(root, dir, '.env.example');
  const local = join(root, dir, '.env.local');
  if (!existsSync(example)) continue;
  if (existsSync(local)) {
    console.log(`\nkept   ${dir}/.env.local (already present)`);
    continue;
  }
  copyFileSync(example, local);
  console.log(`\ncreated ${dir}/.env.local from .env.example`);
  created += 1;
}

console.log('\n---\n');
console.log('Ready. Next:');
console.log('  pnpm dev                                              start everything');
console.log(
  '  pnpm --filter @crossscreen/desktop run verify:capture  check this platform can capture',
);

if (created > 0) {
  console.log('\nThe new .env.local files point at a local signaling server.');
  console.log('For the cross-network test, set VITE_SIGNALING_URL to your tunnel URL.');
}

if (process.platform === 'darwin') {
  console.log('\nmacOS: the first capture asks for Screen Recording permission,');
  console.log('and the app must be restarted after granting it before capture works.');
}
