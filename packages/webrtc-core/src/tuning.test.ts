import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyContentHint, applyDegradationPreference } from './tuning.ts';

/**
 * The two modes have to be genuine opposites, because they answer the same
 * question in opposite directions and a mistake here is invisible in code
 * review and very visible on someone's screen.
 *
 * `text` holding resolution is what keeps a spreadsheet readable — and what
 * made a shared video look frozen, which is how this control came to exist.
 */

function fakeTrack() {
  return { contentHint: '' } as MediaStreamTrack;
}

function fakeSender() {
  const params = {
    degradationPreference: undefined as RTCDegradationPreference | undefined,
    encodings: [{ maxFramerate: undefined as number | undefined }],
  };
  return {
    params,
    getParameters: () => params,
    setParameters: (next: typeof params) => {
      Object.assign(params, next);
      return Promise.resolve();
    },
  } as unknown as RTCRtpSender & { params: typeof params };
}

test('text mode holds resolution and hints at detail', async () => {
  const track = fakeTrack();
  const sender = fakeSender();

  applyContentHint(track, 'text');
  await applyDegradationPreference(sender, 'text');

  assert.equal(track.contentHint, 'text');
  assert.equal(sender.params.degradationPreference, 'maintain-resolution');
});

test('motion mode holds frame rate and hints at movement', async () => {
  const track = fakeTrack();
  const sender = fakeSender();

  applyContentHint(track, 'motion');
  await applyDegradationPreference(sender, 'motion');

  assert.equal(track.contentHint, 'motion');
  assert.equal(sender.params.degradationPreference, 'maintain-framerate');
});

test('the two modes are actual opposites', async () => {
  // If both ever resolved to the same preference the control would appear to
  // work and change nothing, which is the worst way for this to break.
  const textSender = fakeSender();
  const motionSender = fakeSender();

  await applyDegradationPreference(textSender, 'text');
  await applyDegradationPreference(motionSender, 'motion');

  assert.notEqual(
    textSender.params.degradationPreference,
    motionSender.params.degradationPreference,
  );
});

test('text is the default, because that is what the product is for', async () => {
  const track = fakeTrack();
  const sender = fakeSender();

  applyContentHint(track);
  await applyDegradationPreference(sender);

  assert.equal(track.contentHint, 'text');
  assert.equal(sender.params.degradationPreference, 'maintain-resolution');
});

test('the frame-rate ceiling applies in both modes', async () => {
  for (const mode of ['text', 'motion'] as const) {
    const sender = fakeSender();
    await applyDegradationPreference(sender, mode);
    assert.equal(sender.params.encodings[0]?.maxFramerate, 30, mode);
  }
});

test('a track without contentHint support is left alone rather than crashing', () => {
  // Not every implementation has it, and losing the hint is far better than
  // losing the share.
  const bare = {} as MediaStreamTrack;
  assert.doesNotThrow(() => {
    applyContentHint(bare, 'motion');
  });
});
