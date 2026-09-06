import { MEDIA_DEFAULTS } from '@crossscreen/protocol';

/**
 * Screen-share media tuning.
 *
 * WebRTC's defaults are tuned for camera video, where smooth motion matters
 * more than fine detail. Screen content is the opposite: it is mostly static,
 * mostly text, and the whole point is that the other person can read it.
 *
 * Two settings carry almost all of the difference, and they are applied here
 * rather than at each call site so the desktop and browser sharers cannot
 * drift apart (architecture §9).
 */

/**
 * Tell the encoder this track is detailed rather than fast-moving. Chromium
 * uses this to enable screen-content coding paths in VP9 and AV1.
 */
export function applyContentHint(track: MediaStreamTrack): void {
  if ('contentHint' in track) {
    track.contentHint = MEDIA_DEFAULTS.contentHint;
  }
}

/**
 * Under bandwidth pressure, drop frame rate and hold resolution.
 *
 * This is the load-bearing line of the whole media configuration. The default
 * is `balanced`, which will happily shrink a 1080p screen to something where
 * a spreadsheet is unreadable. Blurry text is a failed session; legible text
 * at 8 fps is a usable one.
 */
export async function applyDegradationPreference(sender: RTCRtpSender): Promise<void> {
  const params = sender.getParameters();
  params.degradationPreference = MEDIA_DEFAULTS.degradationPreference;

  const [encoding] = params.encodings ?? [];
  if (encoding !== undefined) {
    encoding.maxFramerate = MEDIA_DEFAULTS.maxFps;
  }

  await sender.setParameters(params);
}

/**
 * Cap the captured resolution, never raising it.
 *
 * Architecture §9 asks for 1920x1080 alongside the two settings above, and it
 * was the one of the three that never got applied. That went unnoticed because
 * the machine it was first measured on has a 1080p display, so the capture came
 * in under the ceiling on its own and the baseline recorded `1920x1080` as
 * though the cap had done it.
 *
 * A Retina Mac gives 2940x1912 — 5.6 megapixels against the 2.1 the contract
 * states, so nearly three times the pixels to encode and send. That is affordable
 * on loopback and is exactly the wrong thing to discover on a phone over mobile
 * data, where it would look like a network problem rather than a missing
 * constraint.
 *
 * Only `max` is constrained, so a screen already smaller than the ceiling is
 * left alone — "never upscale", as §9 puts it. The browser fits the frame
 * inside the box and keeps the aspect ratio, so a 2940x1912 screen becomes
 * 1661x1080 rather than being squashed to shape.
 */
export async function applyResolutionCap(track: MediaStreamTrack): Promise<void> {
  if (typeof track.applyConstraints !== 'function') return;

  const { width, height } = track.getSettings();
  if (
    width !== undefined &&
    height !== undefined &&
    width <= MEDIA_DEFAULTS.maxWidth &&
    height <= MEDIA_DEFAULTS.maxHeight
  ) {
    return;
  }

  try {
    await track.applyConstraints({
      width: { max: MEDIA_DEFAULTS.maxWidth },
      height: { max: MEDIA_DEFAULTS.maxHeight },
    });
  } catch {
    // Reconstraining a display track is not universally supported. Sending the
    // full-resolution screen is worse than sending a capped one but far better
    // than sending nothing, so this stays a preference rather than a hard step.
  }
}

/**
 * Prefer codecs with screen-content coding tools, keeping H.264 as the
 * universal fallback — it is the only codec every target platform decodes in
 * hardware, Safari and older Android included.
 *
 * AV1 compresses text best but costs roughly 3-5x VP9 to encode, and hardware
 * decode is still rare on Android, so it is deliberately not preferred here.
 * It becomes an opt-in mode in Phase 6.
 */
export function applyCodecPreferences(transceiver: RTCRtpTransceiver): void {
  if (typeof RTCRtpSender.getCapabilities !== 'function') return;
  if (typeof transceiver.setCodecPreferences !== 'function') return;

  const supported = RTCRtpSender.getCapabilities('video')?.codecs;
  if (supported === undefined) return;

  const rank = (mime: string): number => {
    const name = mime.split('/')[1]?.toUpperCase() ?? '';
    const index = MEDIA_DEFAULTS.codecPreference.indexOf(
      name as (typeof MEDIA_DEFAULTS.codecPreference)[number],
    );
    return index === -1 ? MEDIA_DEFAULTS.codecPreference.length : index;
  };

  const ordered = [...supported].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  try {
    transceiver.setCodecPreferences(ordered);
  } catch {
    // Not every browser accepts reordering; the negotiated result is still
    // workable, so this is a preference and never a hard requirement.
  }
}

/**
 * Apply every screen-share tuning step to a freshly added video sender.
 *
 * `MEDIA_DEFAULTS.minFps` has no step here on purpose: WebRTC has no minimum
 * frame rate to set. A floor is what `degradationPreference` produces by
 * refusing to trade resolution away, not something the encoder can be told.
 */
export async function tuneScreenShare(
  track: MediaStreamTrack,
  sender: RTCRtpSender,
  transceiver?: RTCRtpTransceiver,
): Promise<void> {
  applyContentHint(track);
  if (transceiver !== undefined) applyCodecPreferences(transceiver);
  // Before the encoding parameters, so maxFramerate is set against the
  // resolution that will actually be sent.
  await applyResolutionCap(track);
  await applyDegradationPreference(sender);
}
