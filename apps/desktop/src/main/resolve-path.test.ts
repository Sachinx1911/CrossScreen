import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { test } from 'node:test';

import { resolveWithin } from './resolve-path.ts';

const ROOT = join(sep, 'app', 'dist', 'renderer');

test('a normal asset resolves inside the root', () => {
  assert.equal(resolveWithin(ROOT, '/index.html'), join(ROOT, 'index.html'));
  assert.equal(resolveWithin(ROOT, '/assets/index-abc.js'), join(ROOT, 'assets', 'index-abc.js'));
});

test('an empty path and a bare slash both mean index.html', () => {
  assert.equal(resolveWithin(ROOT, '/'), join(ROOT, 'index.html'));
  assert.equal(resolveWithin(ROOT, ''), join(ROOT, 'index.html'));
});

test('escaping the root is refused', () => {
  // These reach the handler already flattened when they come through a URL
  // parser. Passed in raw — which is what a future caller might do — they are
  // refused here rather than read off the filesystem.
  assert.equal(resolveWithin(ROOT, '/../../etc/passwd'), null);
  assert.equal(resolveWithin(ROOT, '/../renderer-secrets'), null);
});

test('percent-encoded traversal is refused once decoded', () => {
  assert.equal(resolveWithin(ROOT, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('a sibling directory sharing the prefix is not inside the root', () => {
  // The separator in the startsWith check is what makes this fail. Without it
  // '/app/dist/renderer-private' would count as inside '/app/dist/renderer'.
  assert.equal(resolveWithin(ROOT, '/../renderer-private/key.pem'), null);
});

test('a malformed escape is refused rather than thrown', () => {
  // decodeURIComponent throws URIError on these. The URL parser does not
  // reject them, so they arrive intact; unhandled, the throw escaped the
  // protocol handler and the request failed with net::ERR_UNEXPECTED instead
  // of an answer.
  for (const path of ['/%', '/%zz', '/a%2', '/%e0%a4']) {
    assert.equal(resolveWithin(ROOT, path), null, `${path} should be refused`);
  }
});

test('double-encoding does not smuggle a traversal through', () => {
  // '%252e' decodes once to '%2e', not to '.', so this is an oddly named file
  // inside the root rather than a way out of it.
  const resolved = resolveWithin(ROOT, '/%252e%252e/x');
  assert.notEqual(resolved, null);
  assert.ok(resolved?.startsWith(ROOT + sep));
});
