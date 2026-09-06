import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

/**
 * Config rejection ends the process, so each case runs in its own.
 *
 * That is the behaviour under test rather than an inconvenience: a bad port
 * has to stop the server, and it has to stop it the way a port clash does —
 * one structured line saying which variable is wrong — instead of an uncaught
 * RangeError from inside `http.listen`.
 */

const here = dirname(fileURLToPath(import.meta.url));

// A file:// URL rather than a plain path. On Windows a bare absolute path is
// rejected by the ESM loader, which reads `D:` as a URL scheme, and its
// backslashes would be escape sequences inside this string literal besides.
const configUrl = pathToFileURL(join(here, 'config.ts')).href;
const LOAD_CONFIG = `import('${configUrl}').then((m) => console.log(m.config.port));`;

function loadWith(port: string | undefined): { code: number; output: string } {
  const env = { ...process.env };
  if (port === undefined) delete env['SIGNALING_PORT'];
  else env['SIGNALING_PORT'] = port;

  try {
    const output = execFileSync(process.execPath, ['-e', LOAD_CONFIG], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, output: e.stdout + e.stderr };
  }
}

test('the default applies when the variable is absent or blank', () => {
  assert.equal(loadWith(undefined).output.trim(), '8787');
  assert.equal(loadWith('').output.trim(), '8787');
  assert.equal(loadWith('   ').output.trim(), '8787');
});

test('a valid port is used as given', () => {
  assert.equal(loadWith('8788').output.trim(), '8788');
  assert.equal(loadWith(' 8788 ').output.trim(), '8788');
});

test('trailing rubbish is refused rather than quietly truncated', () => {
  // parseInt('8788x') is 8788, so this used to start a server on a port the
  // person did not choose while VITE_SIGNALING_URL still pointed at the one
  // they thought they had set.
  for (const value of ['8788x', '87 88', '8788,8789', '87.88']) {
    const { code, output } = loadWith(value);
    assert.equal(code, 1, `${value} should be refused`);
    assert.match(output, /signaling\.bad_config/);
  }
});

test('a port outside the range is refused before http.listen sees it', () => {
  // http.listen throws a RangeError synchronously for these, which the 'error'
  // handler never receives — so the port-in-use reporting was bypassed and it
  // surfaced as an uncaught exception.
  for (const value of ['99999', '-1', '0', '65536']) {
    const { code, output } = loadWith(value);
    assert.equal(code, 1, `${value} should be refused`);
    assert.match(output, /must be between 1 and 65535/);
  }
});

test('the refusal names the variable and the value', () => {
  const { output } = loadWith('abc');
  const line = JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;
  assert.equal(line['event'], 'signaling.bad_config');
  assert.equal(line['variable'], 'SIGNALING_PORT');
  assert.equal(line['value'], 'abc');
});
