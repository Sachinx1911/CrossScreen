# Phase 4 — Android Sharing

**Estimate:** 6–8 weeks part-time · **Depends on:** Phase 3a
**Planning depth:** medium. Full breakdown written at the start of Phase 3b.

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

- Kotlin app: Share and Join, following the mobile layouts in the mockup.
- `MediaProjection` capture wired into `org.webrtc`, feeding the same signaling
  protocol as every other client.
- **Kotlin protocol types generated from `packages/protocol/schema`**, not
  hand-written. This is the moment the JSON Schema work in Phase 0 pays for
  itself, and hand-copying here would guarantee drift.
- Foreground service with correct ordering and a persistent notification.
- Honest handling of every OS-enforced interruption above.
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
