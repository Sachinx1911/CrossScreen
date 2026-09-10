# Phase 4 — Android Sharing

**Estimate:** 6–8 weeks part-time · **Depends on:** Phase 3a
**Planning depth:** medium. Full breakdown written at the start of Phase 3b.

**Status (2026-09-10):** toolchain proven, protocol types generated, and
the capture path — `MediaProjection` consent, the Android 14+
foreground-service ordering, and a WebRTC `VideoTrack` via
`org.webrtc`'s `ScreenCapturerAndroid`, rendered locally in Active Sharing
— **written but not yet build-verified** (the coding agent's shell cannot
run a Gradle build task, only `./gradlew --version`; a machine with a
real build must confirm it). The four v1 screens build and run on an
Android 15 emulator, and **Kotlin protocol types are generated from
`packages/protocol`**, `kotlinx.serialization`-wired, round-trip tested.
See [`apps/android/README.md`](../../apps/android/README.md#screen-capture-mediaprojection--foreground-service--webrtc-videotrack)
for what is proven versus what a build still has to confirm. Still to do:
a Kotlin signaling client and a `PeerConnection` — the first time a
phone-originated session touches the server.

## Goal

The first genuinely new capability after the MVP: sharing a phone screen.
Android viewing already works through the browser and needs nothing.

Native Kotlin with Google's `org.webrtc` (ADR-0003). The app is two screens —
Share and Join — so a cross-platform framework would add a layer without
earning one.

## Why this is 6–8 weeks for two screens

Almost none of the effort is UI. It is the platform rules, which are strict,
version-dependent, and unforgiving:

- The **foreground service must start before** `MediaProjection`. Android 14+
  throws `SecurityException` on the wrong order.
- **Consent is required for every session.** The projection token cannot be
  cached across restarts, so there is no "remember this choice" to build.
- **Capture stops when the screen locks** (Android 15 QPR1+). A user cannot
  start a share and pocket the phone. This is a product constraint to explain
  in the UI, not a bug to fix.
- A **system chip** lets the user kill the share from outside our app, so the
  stream can end at any moment without our code being asked first.
- Battery, thermal throttling and background restrictions all bear on a
  long-running capture.

## Deliverables

- ~~Kotlin app: Share and Join, following the mobile layouts in the mockup.~~
  **Done, 2026-09-08; Splash + Onboarding + Join paste + a Home/Sessions/
  Settings bottom nav + local session history added 2026-09-10 (unverified
  by build).** The full v1 screen list from
  [`docs/ui-scope-mobile.md`](../ui-scope-mobile.md) §2 except a dedicated
  Viewer (its own open question), and minus the M1/M3 cuts (accounts,
  Devices). Kept dependency-free — history is a `SharedPreferences` JSON
  string, navigation is a `Crossfade`. See
  [`apps/android/README.md`](../../apps/android/README.md).
- `MediaProjection` capture wired into `org.webrtc`, feeding the same signaling
  protocol as every other client. **Written end to end, 2026-09-10,
  unverified by build:** consent + ordering + `ScreenCapturerAndroid` →
  `VideoSource(isScreencast=true)` → `VideoTrack`, then a `net/SharerSession`
  and `net/ViewerSession` (ports of `packages/webrtc-core/`) that create a
  session over the API, attach over the signaling WebSocket, and negotiate a
  `PeerConnection`. Happy path only — no reconnection/resume, stats, tuning,
  forced relay, ICE-restart, or multi-viewer yet. Needs a real build + a
  reachable server (Settings → Server) to confirm.
- ~~Kotlin protocol types generated from `packages/protocol/schema`, not
  hand-written.~~ **Done, 2026-09-08.** `pnpm --filter @crossscreen/protocol
generate:kotlin` — see [`apps/android/README.md`](../../apps/android/README.md#protocol-types).
- ~~Foreground service with correct ordering and a persistent notification.~~
  **Done, 2026-09-10, unverified by build.** `ScreenShareService` — see
  [`apps/android/README.md`](../../apps/android/README.md#screen-capture-mediaprojection--foreground-service--webrtc-videotrack).
- Honest handling of every OS-enforced interruption above. Started:
  `MediaProjection.Callback.onStop()` covers the kill-switch chip and
  Android 15 QPR1+'s screen-lock stop, surfaced as a plain-language message
  on Home. Not yet covered: anything past capture stopping, since nothing
  past capture (a live connection, a viewer) exists yet.
- Play Store listing, signing and release track.

## Exit criteria

1. An Android phone shares its screen to a desktop browser, over both P2P and
   relayed paths.
2. All the OS interruptions above are handled without a crash, and each is
   explained to the user in plain language.
3. Phase 2's reconnection behaviour holds across a Wi-Fi to mobile handover on
   the phone itself.
4. Battery drain over a 15-minute share is measured and stated.
5. The app passes Play Store review, including the disclosures that screen
   capture requires.
6. Kotlin types are generated, and CI fails if they drift from the schema.
   Half done: generated and tested; CI enforcement is not built yet.

## Open questions for the full plan

- Does the Android app also need to _view_, or does the browser cover it
  entirely? The browser almost certainly covers it — resist building a viewer
  for its own sake.
- 720p or 1080p by default from a phone? Thermal behaviour decides this, and it
  should be measured rather than assumed.
- Which minimum SDK? Higher means fewer branches around behaviour changes;
  lower means more devices. Decide from actual usage data, not instinct.

## Risks

| Risk                                                   | Mitigation                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Android version fragmentation around `MediaProjection` | Test on the oldest supported version and the newest, not only a current device     |
| Play Store review scrutinises screen capture closely   | Prepare the privacy disclosures early; a rejection costs a week                    |
| Thermal throttling degrades long shares                | Measure, then cap resolution or frame rate accordingly rather than promising 1080p |
