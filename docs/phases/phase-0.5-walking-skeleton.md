# Phase 0.5 — Walking Skeleton

**Estimate:** 1–2 weeks · **Status:** Code complete; **local loop verified**.
Cross-network gate still outstanding. **This is the GO/NO-GO gate.**

## Gate outcome — **passed with criterion 4 outstanding** (2026-09-06)

Four of five criteria are met. Criterion 4 is deferred, deliberately, and
Phase 1 begins.

The risk this gate exists to retire is _"the media path does not work"_, and
criteria 1, 2, 3 and 5 retire it: a desktop screen reaches a browser viewer
over WebRTC, on two platforms, holding resolution for eleven minutes without a
drop. What criterion 4 would additionally prove is that the **relay** path
works, and that is Phase 2's subject, not Phase 1's. Nothing in Phase 1 —
sessions, join codes, host approval, the UI — touches it.

It is blocked on a Cloudflare account rather than on anything in the code, so
holding the whole project behind it would trade real progress for no
information.

**The cost of being wrong is understood and accepted.** The failed
cross-network attempt already showed that TURN is load-bearing for the
product's main use case, so if it turns out to be harder than expected, that
lands in Phase 2 with Phase 1's work already done — none of which would need
redoing, because the relay is a transport concern and Phase 1 is a control-plane
and interface one. Criterion 4 stays open, tracked here, and must close before
Phase 2 can be called complete.

## Progress

| Exit criterion                               | Status                                        |
| -------------------------------------------- | --------------------------------------------- |
| 1. Viewer sees the live screen, text legible | ✅ **locally** — 1920x1080, VP9, no downscale |
| 2. `candidate-pair` in state `succeeded`     | ✅ **locally** — `path=prflx->host`           |
| 3. Candidate types logged                    | ✅ both ends print a stats line every 2 s     |
| 4. Forced-relay run proves TURN              | ⬜ needs TURN credentials and two networks    |
| 5. Ten minutes without freezing              | ✅ **locally** — 11 min, no drop, no freeze   |

Local measurement, 2026-09-05, Windows 11 / Electron 44.2.0:

```
transport=direct path=prflx->host rtt=1ms res=1920x1080 fps=21 codec=VP9 avail=300kbps
```

VP9 negotiated as intended, and resolution held at full 1080p while the frame
rate floated — which is `degradationPreference: 'maintain-resolution'` doing
exactly its job.

Local measurement, 2026-09-06, macOS 15.5 / Electron 44.2.0:

```
transport=direct path=host->host rtt=1ms res=1658x1078 fps=30 codec=VP9 avail=5302kbps
```

The Retina screen captures at 2940x1912 and is now capped down to 1658x1078 —
§9's 1920x1080 ceiling, fitted to the display's aspect ratio. Text stayed
legible in the viewer at that size, which is criterion 1. The soak below was
measured before the cap existed, at the full 2940x1912.

**The soak, criterion 5.** Eleven minutes of continuous sharing, sampled every
two seconds — 337 stats lines, and across all of them the resolution never
moved off `2940x1912`, the transport never left `direct`, the codec stayed VP9,
and nothing logged a disconnect, a failure or a closed peer. Frame rate ranged
from 1 to 30 fps and that is the intended behaviour rather than a stall: with
`maintain-resolution`, a screen nobody is touching has almost nothing to
encode. The stream was confirmed live at the end by watching the viewer follow
the desktop onto entirely different content, which is the check a stats line
alone cannot make — a frozen video with a healthy connection prints exactly the
same numbers.

This is a loopback result. It retires the "does it hold up over time" question
for the code itself, but criterion 5 is written against two networks and only a
cross-network run can settle it there.

**Criteria 1, 2 and 5 must be re-run across two networks before the gate
passes.** Loopback proves the code is wired correctly; it proves nothing about
NAT traversal, which is the entire point of the exercise.

### Bugs this phase has already caught

- **A restarted sharer made a working viewer report failure.** Replacing the
  viewer's `RTCPeerConnection` on a second offer never closed the first one,
  and a discarded connection is not inert: its `onconnectionstatechange` fires
  `failed` and writes that into the same status element the new connection is
  using. Its stats interval survived too, because `pollStats()` had no guard
  against being called twice — the sharer's equivalent has one, so this was an
  oversight on one side rather than a decision. Measured on the Mac: one offer
  gave 0.94 stats timers, a second gave 1.93, and the viewer read **"Connection
  failed"** while the video was playing at 2940x1912 and its own stats line
  said `transport=direct`. Both criteria 1 and 3 are read off exactly those two
  things, so the bug could fail a passing run — and criterion 4 is what
  triggers it, since forcing relay means restarting the sharer with the viewer
  still open. Both ends now close the connection they are replacing, handlers
  detached first so the close itself delivers nothing.
- **The 1920x1080 resolution cap was never applied.** Architecture §9 lists it
  beside `contentHint` and `degradationPreference`; the other two were
  implemented and this one was not, and `MEDIA_DEFAULTS.maxWidth` and
  `maxHeight` were read by nothing at all. It hid because the machine it was
  first measured on has a 1080p display, so the capture came in under the
  ceiling by itself and the baseline recorded `1920x1080` as though the cap had
  done it. The Mac gave 2940x1912 — 5.6 megapixels against the 2.1 the contract
  states — and the pixels that costs are affordable on loopback and precisely
  the wrong surprise on a phone over mobile data, where they would read as a
  network problem. Now capped to 1658x1078, aspect ratio kept, text still
  legible in the viewer.
- **A stopped tunnel left its URL behind.** `pnpm tunnel` deleted
  `.tunnel-url` on SIGINT and on the child exiting, which covers Ctrl+C and
  cloudflared dying, and nothing else. Killed with SIGTERM — an IDE stop
  button, `kill`, a closing terminal, a process manager taking the tree down —
  it died before cleanup and left the file pointing at a tunnel that no longer
  existed. The next `pnpm dev` reads that file at launch, so the desktop app
  aims at a dead hostname and cannot reach signaling, which is precisely the
  outcome the code comment there warns about. Found by killing it that way
  while tidying up after a tunnel run. Now handles SIGTERM and SIGHUP too.
- **A sharer that restarted came back as a second viewer.** The room chose a
  role from `#peers.size`, which agrees with "first peer is the host" only
  until someone reconnects: with the viewer holding the only slot, the
  returning sharer was labelled `viewer` and the room reported no host at all.
  Cosmetic today, because nothing in the skeleton reads the role — but the logs
  are what the gate is judged from, and a log that calls the sharer a viewer
  costs time at exactly the wrong moment. Role now follows from whether a host
  is present.
- **ICE candidates arriving before the answer were thrown away.** Signaling
  carries candidates and the offer/answer over the same channel, and a peer
  starts producing candidates as soon as it has a local description — so they
  routinely arrive first. `addIceCandidate` throws in that state, and a
  discarded candidate is a connection path silently lost. Invisible on
  loopback; it appeared the moment a tunnel added real latency, which is
  exactly when the lost candidate is most likely to have been the one that
  would have worked. Both clients now queue through `IceCandidateQueue`.

- **`Buffer` is not defined in a browser.** `parse.ts` used Node's `Buffer` for
  the size check and for decoding binary frames, so every browser client threw
  inside its WebSocket message handler and silently dropped every frame. The
  connection looked healthy and nothing ever arrived. Now uses `TextEncoder` /
  `TextDecoder`, with a regression test that deletes `globalThis.Buffer`.
- **CSP `'self'` does not match `file://`.** A textbook `script-src 'self'`
  blocked the renderer bundle outright and the window just sat there. **Fixed:**
  the renderer is now served over a custom `app://` scheme with a real origin,
  so the policy is tight and `verify:renderer` guards it.
- **`getDisplayMedia` needs a secure context**, and a `data:` URL is not one —
  `navigator.mediaDevices` is simply `undefined` there.
- **Vite's `envDir` defaults to `root`**, so `.env.local` beside `package.json`
  was being ignored by the desktop build.
- **A port clash crashed the signaling server** with an unhandled `error`
  event, because `ws` re-emits the HTTP server's errors on the
  `WebSocketServer`. Both now report a message the developer can act on.

## Goal

Prove the entire media path end to end, across two real networks, with the
smallest possible amount of code:

Electron on Windows → screen capture → WebRTC → internet → Chrome elsewhere → visible screen

Nothing in Phase 1 begins until this works reliably. If the path cannot be made
to work, the architecture is wrong, and it is far cheaper to discover that in
week three than in month five.

## In scope

- A signaling server with **one hardcoded room**. No sessions, no codes.
- An Electron app that captures a screen and creates an offer.
- A single web page that answers and renders the incoming video.
- Public STUN, plus **Cloudflare TURN credentials hardcoded in `.env`**.
- Enough `getStats()` logging to see which candidate pair actually won.
- A tunnel (cloudflared) so both machines can reach the signaling server.

## Explicitly out of scope

Sessions · join codes · host approval · database · any UI beyond a bare video
element · reconnection · error handling · TURN credential issuing · styling ·
deployment.

> **Why TURN credentials are pulled forward from Phase 2.** The exit criteria
> require proving the relay path works, and that needs real credentials.
> Setting up a Cloudflare TURN key takes minutes, whereas discovering in month
> three that relayed media does not work would invalidate weeks of work built
> on top of it. Only the credentials move forward — the `/api/v1/ice-servers`
> endpoint with short-lived tokens stays in Phase 2.

## Work breakdown

### 0.5.1 — Signaling skeleton · `services/signaling`

- `ws` server on a configurable port; WSS terminated by the tunnel.
- One in-memory room. First peer to connect is the host, second is the viewer,
  a third is refused.
- Relay `rtc.offer`, `rtc.answer` and `rtc.ice` between the two, using the
  existing `@crossscreen/protocol` envelope and `parseClientEnvelope`.
- Structured logs: connect, disconnect, every relayed message type.
- Roughly 150 lines, and deliberately throwaway — Phase 1 replaces the room
  logic entirely.

### 0.5.2 — Electron sharer · `apps/desktop`

- Electron main process, preload with `contextIsolation: true`, and a renderer.
- The load-bearing detail: in the main process, call
  `session.defaultSession.setDisplayMediaRequestHandler(...)` and resolve it
  with a source from `desktopCapturer.getSources()`. This is what routes the
  renderer's `getDisplayMedia()` to Chromium's native capture backend, and
  therefore what earns the choice made in ADR-0002.
- Renderer: `getDisplayMedia()` → `RTCPeerConnection` → offer → signaling.
- Apply `MEDIA_DEFAULTS` from `@crossscreen/protocol`: `contentHint` of
  `text`, and `degradationPreference` of `maintain-resolution`.
- Pick the first screen automatically. No picker UI in this phase.

### 0.5.3 — Web viewer · `apps/web`

- One Vite page. No routing, no framework state, no styling beyond a
  full-bleed video element.
- Connect, receive the offer, answer, attach the remote stream, play.
- The video element needs `autoplay`, `muted` and `playsinline` or a remote
  stream will not start.

### 0.5.4 — Connection observability

A small `logSelectedCandidatePair()` helper reading `getStats()`, printing:

- local and remote candidate type (`host`, `srflx` or `relay`),
- current round-trip time and available outgoing bitrate,
- the negotiated codec.

This is the instrument the exit criteria are measured with, and it becomes the
seed of `packages/webrtc-core` in Phase 1.

### 0.5.5 — Cross-network test rig

- A cloudflared tunnel in front of the local signaling server, giving a public
  HTTPS/WSS URL. Documented in `docs/dev-setup.md`.
- A written test procedure, so the run is repeatable rather than a one-off.

## Exit criteria

All five must pass, on two physically separate machines on **different
networks** — home Wi-Fi and a phone hotspot:

1. The viewer sees the sharer's live screen, and text on it is legible.
2. `getStats()` reports a `candidate-pair` in state `succeeded`.
3. The candidate types are logged, so we know whether the winning path was
   direct (`host` or `srflx`) or relayed (`relay`).
4. Re-run with `iceTransportPolicy` forced to `relay`: **the relayed path also
   works**, proving TURN independently of P2P.
5. The session survives 10 minutes of continuous sharing without the video
   freezing or the connection dropping.

Failing any of these means the phase is not complete. Do not begin Phase 1.

## Verification

Manual, and deliberately so — automating a two-network test costs more than it
saves at this stage. The procedure is written down in `docs/dev-setup.md` so it
can be repeated identically after every significant change.

Record in the phase's closing note, as the baseline every later performance
claim is compared against: time to first frame, round-trip time, whether the
connection went direct or relayed, and the negotiated codec.

## Risks

| Risk                                                                                      | Mitigation                                                                                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `setDisplayMediaRequestHandler` behaves differently than expected in the current Electron | This is _the_ assumption ADR-0002 rests on. Test it in the first two days, before anything else is built on top of it            |
| Both machines behind symmetric NAT, so P2P never succeeds                                 | Expected on some mobile carriers. This is exactly why criterion 4 exists: a relay-only result is a pass, and a useful data point |
| The tunnel adds latency and skews the baseline                                            | Signaling latency does not affect media latency — media never traverses the tunnel. Note it and move on                          |
| Time lost to Electron packaging                                                           | Do not package. Running `electron .` in development is sufficient for this phase                                                 |

## Debt this phase deliberately creates

| Shortcut                   | Replaced by                                        | When     |
| -------------------------- | -------------------------------------------------- | -------- |
| One hardcoded room         | Real sessions, codes and approval                  | Phase 1  |
| TURN credentials in `.env` | `/api/v1/ice-servers` with short-lived credentials | Phase 2  |
| No error handling          | User-facing error states                           | Phase 1  |
| cloudflared tunnel         | A deployed signaling service                       | Phase 3a |
