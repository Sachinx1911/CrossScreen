import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deviceLabelFrom } from './device-label.ts';

/**
 * The host approves or rejects on the strength of this one line, so the cases
 * that matter are the browsers that lie about each other in the user agent.
 */

test('common browsers are named correctly despite the user agent lying', () => {
  const cases: [string, string][] = [
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      'Windows · Chrome',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      'Windows · Edge',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mac · Safari',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
      'Android · Chrome',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone · Safari',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Linux · Firefox'],
  ];

  for (const [userAgent, expected] of cases) {
    assert.equal(deviceLabelFrom(userAgent), expected, userAgent.slice(0, 40));
  }
});

test('Android is not mistaken for Linux', () => {
  // Every Android user agent contains "Linux", so order of testing matters.
  const android =
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
  assert.ok(deviceLabelFrom(android).startsWith('Android'));
});

test('an absent or unrecognised user agent still produces something showable', () => {
  assert.equal(deviceLabelFrom(undefined), 'Unknown device');
  assert.equal(deviceLabelFrom(''), 'Unknown device');
  assert.equal(deviceLabelFrom('curl/8.0'), 'Unknown device');
});
