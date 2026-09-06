import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRoute } from './router.ts';

/**
 * The case that matters is a share link opened cold. Someone receives
 * `/j/<token>` in a message and taps it, and it has to land on the join screen
 * with the token already in hand — no typing, no second step.
 */

test('a share link lands on join with its token', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUv';
  assert.deepEqual(parseRoute(`/j/${token}`), { name: 'join', token });
});

test('a share link survives a trailing slash', () => {
  // Messaging apps and copy-paste add them, and a link that fails because of
  // one is a link that failed for no reason the user can see.
  const token = 'AbCdEfGhIjKlMnOpQrStUv';
  assert.deepEqual(parseRoute(`/j/${token}/`), { name: 'join', token });
});

test('the named screens resolve', () => {
  assert.deepEqual(parseRoute('/'), { name: 'home' });
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('/share'), { name: 'share' });
  assert.deepEqual(parseRoute('/join'), { name: 'join' });
});

test('an unknown path goes home rather than nowhere', () => {
  // A 404 screen would be a dead end. Home has both of the things anyone
  // arriving here could want.
  assert.deepEqual(parseRoute('/nonsense'), { name: 'home' });
  assert.deepEqual(parseRoute('/j'), { name: 'home' }, 'a link with no token is not a join');
});
