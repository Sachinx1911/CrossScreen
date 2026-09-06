/**
 * Forcing ICE through a relay is how exit criterion 4 proves TURN works
 * independently of P2P. The failure mode when it is misconfigured is the
 * problem: `iceTransportPolicy: 'relay'` tells the browser to discard every
 * candidate that is not a relay candidate, and with no TURN server there are
 * none to keep. ICE then completes having gathered nothing, and the connection
 * fails with no error, no warning and nothing in the logs to say why.
 *
 * That failure is indistinguishable from the one this project has already hit
 * once for real — a sharer and a phone on mobile data finding no path — so the
 * natural reading is "TURN does not work" when the truth is "TURN was never
 * configured", or a credential has a typo in it. Both apps check before they
 * start rather than leaving that to be worked out from a silent failure.
 */

/** Whether any of these servers can actually relay, as opposed to just STUN. */
export function hasTurnServer(servers: readonly RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    return urls.some((url) => {
      // Scheme only. A `turns:` URL relays as much as a `turn:` one, and a host
      // that merely contains the word is not a relay — `stun:turn.example.com`
      // is a STUN server, and matching it would defeat the whole check.
      const scheme = url.slice(0, url.indexOf(':'));
      return scheme === 'turn' || scheme === 'turns';
    });
  });
}
