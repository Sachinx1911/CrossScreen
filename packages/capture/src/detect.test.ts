import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectCapabilities } from './detect.ts';

/**
 * This file encodes the platform matrix, and the matrix is the part of the
 * product most likely to be quietly wrong. Getting it wrong in one direction
 * offers a control that cannot work; in the other, it hides sharing from
 * someone whose browser would have managed it perfectly well.
 */

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

test('a desktop browser can share, and the browser draws the picker', () => {
  for (const userAgent of [UA.chromeWindows, UA.chromeMac, UA.edgeWindows, UA.firefoxLinux]) {
    const caps = detectCapabilities({ userAgent, hasGetDisplayMedia: true });
    assert.equal(caps.canShare, true, userAgent.slice(0, 30));
    assert.equal(caps.platformPicker, true, 'ours would be a redundant second dialog');
    assert.equal(caps.windowCapture, true);
  }
});

test('a phone cannot share, and is told why in plain language', () => {
  for (const userAgent of [UA.chromeAndroid, UA.safariIphone, UA.safariIpad]) {
    // Even claiming getDisplayMedia exists must not change this: no mobile
    // browser can capture a screen, and there is no workaround.
    const caps = detectCapabilities({ userAgent, hasGetDisplayMedia: true });
    assert.equal(caps.canShare, false, userAgent.slice(0, 30));
    assert.ok(caps.reason, 'a refusal without a reason reads as a bug');
    assert.ok(!/getDisplayMedia|API|codec/i.test(caps.reason), 'no jargon reaches the user');
    assert.match(caps.reason, /watch|share from a computer/i, 'says what they CAN do');
  }
});

test('an iPad is not mistaken for a Mac', () => {
  // iPadOS reports "Macintosh" in some configurations; the iPad string here is
  // the ordinary one, and getting this wrong tells a tablet it can share.
  assert.equal(
    detectCapabilities({ userAgent: UA.safariIpad, hasGetDisplayMedia: true }).canShare,
    false,
  );
  assert.equal(
    detectCapabilities({ userAgent: UA.chromeMac, hasGetDisplayMedia: true }).canShare,
    true,
  );
});

test('a browser without the API is refused, and pointed somewhere that works', () => {
  const caps = detectCapabilities({ userAgent: UA.safariMac, hasGetDisplayMedia: false });
  assert.equal(caps.canShare, false);
  assert.match(caps.reason ?? '', /Chrome, Edge or Firefox/);
});

test('system audio is offered only where it exists', () => {
  // Firefox does not implement it in getDisplayMedia; Safari is unreliable.
  const chrome = detectCapabilities({ userAgent: UA.chromeWindows, hasGetDisplayMedia: true });
  const firefox = detectCapabilities({ userAgent: UA.firefoxLinux, hasGetDisplayMedia: true });
  const safari = detectCapabilities({ userAgent: UA.safariMac, hasGetDisplayMedia: true });

  assert.equal(chrome.systemAudio, true);
  assert.equal(firefox.systemAudio, false, 'Firefox has no system audio to offer');
  assert.equal(safari.systemAudio, false);
});

test('Safari is marked best-effort rather than silently unreliable', () => {
  const caps = detectCapabilities({ userAgent: UA.safariMac, hasGetDisplayMedia: true });
  assert.equal(caps.canShare, true);
  assert.match(caps.reason ?? '', /best-effort/i);
});

test('the desktop app draws its own picker and does not defer to a dialog', () => {
  const caps = detectCapabilities({
    userAgent: UA.chromeWindows,
    hasGetDisplayMedia: true,
    isElectron: true,
  });
  assert.equal(caps.platformPicker, false, 'the app reaches the native backend directly');
  assert.equal(caps.systemAudio, true, 'Windows first, per Phase 6');
});

test('the desktop app does not promise system audio off Windows', () => {
  const caps = detectCapabilities({
    userAgent: UA.chromeMac,
    hasGetDisplayMedia: true,
    isElectron: true,
  });
  assert.equal(caps.systemAudio, false, 'unverified elsewhere, so not offered');
});

test('an empty user agent is treated as a desktop browser, not refused', () => {
  // Failing open here is the right way round: a missing user agent is far more
  // likely to be a privacy setting than a phone, and refusing costs a user.
  const caps = detectCapabilities({ userAgent: '', hasGetDisplayMedia: true });
  assert.equal(caps.canShare, true);
});
