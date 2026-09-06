import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

/**
 * Config rejection ends the process, so each case runs in its own.
 *
 * The one that matters most is the missing secret. A development fallback
 * would be the obvious convenience and exactly the wrong one: it would work
 * locally, survive review, and reach production as a publicly known signing
 * key for every host token ever issued.
 */

const here = dirname(fileURLToPath(import.meta.url));

// A file:// URL, not a bare path: on Windows the ESM loader reads `D:` as a
// URL scheme and refuses it, and the backslashes would be escape sequences
// inside this string literal besides.
const configUrl = pathToFileURL(join(here, 'config.ts')).href;
const LOAD = `import('${configUrl}').then((m) => console.log(m.config.port));`;

const VALID_SECRET = 'a-test-secret-long-enough-to-be-accepted';

function loadWith(overrides: Record<string, string | undefined>): {
  code: number;
  output: string;
} {
  // Built by filtering rather than by deleting keys: `undefined` in an
  // override means "unset this variable", and the child must not inherit it.
  const base: Record<string, string | undefined> = {
    ...process.env,
    SESSION_SECRET: VALID_SECRET,
    LOG_LEVEL: 'error',
    ...overrides,
  };
  const env = Object.fromEntries(
    Object.entries(base).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;

  try {
    const output = execFileSync(process.execPath, ['-e', LOAD], {
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

test('a valid configuration starts', () => {
  assert.equal(loadWith({}).output.trim(), '8788');
  assert.equal(loadWith({ API_PORT: '9000' }).output.trim(), '9000');
});

test('a missing session secret refuses to start', () => {
  const { code, output } = loadWith({ SESSION_SECRET: undefined });
  assert.equal(code, 1, 'the service must not start without a signing secret');
  assert.match(output, /api\.bad_config/);
  assert.match(output, /SESSION_SECRET/);
  assert.match(output, /is required/);
});

test('a blank session secret is refused too', () => {
  assert.equal(loadWith({ SESSION_SECRET: '' }).code, 1);
  assert.equal(loadWith({ SESSION_SECRET: '   ' }).code, 1);
});

test('a short session secret is refused', () => {
  const { code, output } = loadWith({ SESSION_SECRET: 'too-short' });
  assert.equal(code, 1);
  assert.match(output, /at least 32 characters/);
});

test('the secret is never printed, even while refusing it', () => {
  // A rejection is written to the logs, and logs travel. The value that is
  // wrong must not travel with them.
  const secret = 'short-but-recognisable-secret';
  const { output } = loadWith({ SESSION_SECRET: secret });
  assert.ok(!output.includes(secret), 'the secret appeared in the refusal');
  assert.match(output, /hidden/);
});

test('a bad port is refused rather than truncated', () => {
  for (const value of ['8788x', '87 88', '99999', '-1', '0']) {
    const { code, output } = loadWith({ API_PORT: value });
    assert.equal(code, 1, `${value} should be refused`);
    assert.match(output, /api\.bad_config/);
  }
});

test('the refusal names the variable and the reason', () => {
  const { output } = loadWith({ API_PORT: 'abc' });
  const line = JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;
  assert.equal(line['event'], 'api.bad_config');
  assert.equal(line['variable'], 'API_PORT');
  assert.equal(line['service'], 'api');
});
