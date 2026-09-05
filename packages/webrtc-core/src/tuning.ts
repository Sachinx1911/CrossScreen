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

/** Apply every screen-share tuning step to a freshly added video sender. */
export async function tuneScreenShare(
  track: MediaStreamTrack,
  sender: RTCRtpSender,
  transceiver?: RTCRtpTransceiver,
): Promise<void> {
  applyContentHint(track);
  if (transceiver !== undefined) applyCodecPreferences(transceiver);
  await applyDegradationPreference(sender);
}
