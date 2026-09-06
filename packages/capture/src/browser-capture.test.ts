import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BrowserCapture, CaptureCancelled, CaptureRefused } from './browser-capture.ts';

/**
 * The distinction that matters here is between a user changing their mind and
 * a system refusing. Both arrive as `NotAllowedError`, and they need opposite
 * interfaces: one is harmless and should leave no trace, the other is
 * something the person has to go and fix.
 */

const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

/**
 * Stand in for navigator.mediaDevices.
 *
 * Node has its own `navigator` global, defined as a getter with no setter, so
 * assigning to it throws. It has to be redefined and put back.
 */
function withMediaDevices(
  getDisplayMedia: (...args: unknown[]) => Promise<unknown>,
  run: () => Promise<void>,
) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getDisplayMedia } },
    configurable: true,
    writable: true,
  });

  return run().finally(() => {
    if (original === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, 'navigator', original);
  });
}

function domException(name: string, message = ''): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function fakeTrack() {
  return {
    kind: 'video',
    contentHint: '',
    addEventListener: () => undefined,
    stop: () => undefined,
  };
}

function fakeStream() {
  const track = fakeTrack();
  return { getVideoTracks: () => [track], getTracks: () => [track], track };
}

test('a phone refuses before it ever reaches the browser API', async () => {
  const capture = new BrowserCapture({ userAgent: PHONE, hasGetDisplayMedia: true });

  await assert.rejects(() => capture.start(), CaptureRefused);
  assert.equal(capture.stream, undefined);
});

test('dismissing the picker is a cancellation, not an error', async () => {
  // An empty message is what a dismissal looks like: the browser has nothing
  // to explain, because nothing went wrong.
  const capture = new BrowserCapture({ userAgent: DESKTOP, hasGetDisplayMedia: true });

  await withMediaDevices(
    () => Promise.reject(domException('NotAllowedError')),
    async () => {
      await assert.rejects(() => capture.start(), CaptureCancelled);
    },
  );
});

test('a blocked permission is a refusal the user must act on', async () => {
  const capture = new BrowserCapture({ userAgent: DESKTOP, hasGetDisplayMedia: true });

  await withMediaDevices(
    () => Promise.reject(domException('NotAllowedError', 'Disallowed by permissions policy')),
    async () => {
      await assert.rejects(
        () => capture.start(),
        (err: Error) => {
          assert.ok(err instanceof CaptureRefused, 'a policy block is not a cancellation');
          assert.match(err.message, /permissions/i);
          return true;
        },
      );
    },
  );
});

test('every failure produces plain language, never a DOMException name', async () => {
  const capture = new BrowserCapture({ userAgent: DESKTOP, hasGetDisplayMedia: true });

  for (const name of ['NotFoundError', 'NotReadableError', 'AbortError', 'SomethingNew']) {
    await withMediaDevices(
      () => Promise.reject(domException(name, 'raw internal detail')),
      async () => {
        await assert.rejects(
          () => capture.start(),
          (err: Error) => {
            assert.ok(!err.message.includes('Error:'), `${name} leaked its name`);
            assert.ok(!err.message.includes('raw internal detail'), `${name} leaked its message`);
            return true;
          },
        );
      },
    );
  }
});

test('a successful capture is hinted as text by default', async () => {
  const capture = new BrowserCapture({ userAgent: DESKTOP, hasGetDisplayMedia: true });
  const stream = fakeStream();

  await withMediaDevices(
    () => Promise.resolve(stream),
    async () => {
      await capture.start();
      assert.equal(stream.track.contentHint, 'text', 'screen content, not camera video');
      assert.ok(capture.stream, 'the stream is retained');
    },
  );
});

test('optimising for motion is opt-in and leaves the hint alone', async () => {
  const capture = new BrowserCapture({ userAgent: DESKTOP, hasGetDisplayMedia: true });
  const stream = fakeStream();

  await withMediaDevices(
    () => Promise.resolve(stream),
    async () => {
      await capture.start({ optimiseForText: false });
      assert.equal(stream.track.contentHint, '');
    },
  );
});

test('audio is not requested where it cannot be delivered', async () => {
  // Asking Firefox for system audio is not merely ignored — it can fail the
  // whole call, taking the video with it.
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
  const capture = new BrowserCapture({ userAgent: firefox, hasGetDisplayMedia: true });

  let requested: { audio?: boolean } | undefined;
  await withMediaDevices(
    (...args: unknown[]) => {
      requested = args[0] as { audio?: boolean };
      return Promise.resolve(fakeStream());
    },
    async () => {
      await capture.start({ systemAudio: true });
      assert.equal(requested?.audio, false, 'Firefox has no system audio to give');
    },
  );
});

test('the browser draws the picker, so we list no sources', async () => {
  const capture = new BrowserCapture({ userAgent: DESKTOP, hasGetDisplayMedia: true });
  assert.deepEqual(await capture.listSources(), []);
  assert.equal(capture.capabilities().platformPicker, true);
});
