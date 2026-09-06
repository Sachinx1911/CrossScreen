/**
 * A short description of who is asking to join, for the host's approval prompt.
 *
 * The host has to decide whether this is the person they sent the link to, and
 * they get one line to do it with. It is derived server-side from the request
 * rather than taken from the client, because a label the joiner controls is a
 * label a stranger can set to "Rahul's phone".
 *
 * Deliberately coarse. This answers a yes/no question; it is not a device
 * fingerprint, and architecture §42 asks us not to build one.
 */
export function deviceLabelFrom(userAgent: string | undefined): string {
  if (userAgent === undefined || userAgent === '') return 'Unknown device';

  const platform = /iPhone|iPad/i.test(userAgent)
    ? 'iPhone'
    : /Android/i.test(userAgent)
      ? 'Android'
      : /Macintosh|Mac OS X/i.test(userAgent)
        ? 'Mac'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown device';

  // Order matters: Edge and Chrome both claim Safari, and Chrome claims Edge's
  // engine, so the most specific has to be tested first.
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('OPR/')
      ? 'Opera'
      : userAgent.includes('Firefox/')
        ? 'Firefox'
        : userAgent.includes('Chrome/')
          ? 'Chrome'
          : userAgent.includes('Safari/')
            ? 'Safari'
            : undefined;

  return browser === undefined ? platform : `${platform} · ${browser}`;
}
