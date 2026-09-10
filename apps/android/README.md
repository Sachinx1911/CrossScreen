# CrossScreen — Android

Phase 4's app: a Gradle/Kotlin/Compose project covering the v1 screen list
from [`docs/ui-scope-mobile.md`](../../docs/ui-scope-mobile.md) §2 — Splash,
Onboarding (first launch only), a Home / Sessions / Settings bottom nav,
and the Share Setup → Active Sharing and Join → Viewer sub-flows over it.
Sharing and joining go end to end now: `MediaProjection` capture → a WebRTC
`VideoTrack` → a `SharerSession`/`ViewerSession` (`net/`) that create a
session over the HTTP API, attach over the signaling WebSocket, and
negotiate a `PeerConnection`. Built in that order on purpose, the same
order Phase 0.5 held the rest of this project to: prove each layer before
the next depends on it.

**Status: the UI builds and runs** (Home/Share/Active/Join verified
2026-09-08 on an Android 15 `google_apis` x86_64 emulator). **Everything
since — Splash, Onboarding, Sessions, Settings, the bottom nav, the
capture → `VideoTrack` slice, and the whole `net/` signaling + WebRTC
layer — is written but not yet build-verified.** See below for what that
needs.

The phone needs a CrossScreen server it can reach — there is no public one
(ADR-0010). Set it in **Settings → Server**: run the dev stack and
`pnpm tunnel`, paste the `https://…trycloudflare.com` URL. With no server
set, Share still shows the local preview; only the "someone can watch"
half needs one.

Kept lightweight on purpose: no navigation library (a `Crossfade` over a
sealed `Screen`), no database (recent-sessions history is a short JSON
string in `SharedPreferences` via the `kotlinx.serialization` already here
for the wire protocol). One dependency added for the whole networking
layer — OkHttp (WebSocket + HTTP in ~1 MB). The unavoidable weight is the
WebRTC native library (~tens of MB); screen sharing has no lighter path.

Still out of v1 scope, deliberately (ui-scope-mobile.md M1–M6): accounts
and Sign In, the Devices screen, the audio and annotation toggles, per-app
capture, and the whole iOS side. The Settings screen has no account
section and no Sign Out for the same reason (ADR-0007).

## What is actually verified

- The Android SDK is installed and works: `adb version` reports
  1.0.41/37.0.1, `platforms;android-37.0` and `build-tools;36.0.0` are
  present, and `system-images;android-35;google_apis;x86_64` (Android 15,
  the version phase-4-android.md calls out for its screen-lock-stops-capture
  behaviour) installed successfully.
- **Gradle sync and build succeed** in Android Studio, and the app installs
  and launches on the Android 15 emulator, showing the real Compose UI.
- **Command-line builds now work too.** `gradlew`, `gradlew.bat` and
  `gradle-wrapper.jar` are committed, generated with `gradle wrapper
  --gradle-version 9.6.0` from a plain Bash shell on macOS — the sandboxed
  shell described below is not a universal problem, only whatever
  environment first hit it. `./gradlew build` runs the full debug and
  release variants, lint and the (currently empty) unit test task,
  end to end, needing only `sdk.dir` set in a local, gitignored
  `local.properties` — `sdk.dir=<path to the Android SDK>`, wherever
  Android Studio or `sdkmanager` put it on that machine.

## Fixed: the AGP/Gradle version mismatch

The first sync attempt failed with:

```
java.lang.NoClassDefFoundError: org.gradle.features.binding.ProjectTypeBinding
```

**Cause:** the project pinned AGP 9.4.0, and Android Studio's own "use
latest" default pulled Gradle **9.7.1** — one patch release newer than the
Gradle version AGP 9.4.0 actually targets (**9.6.0**, per the [official
release notes](https://developer.android.com/build/releases/agp-9-4-0-release-notes)).
9.7.1 changed an internal (non-public) Gradle class that AGP 9.4.0's
plugin code depends on by exact shape, hence `NoClassDefFoundError` rather
than a version-mismatch warning.

**Fix:** `gradle/wrapper/gradle-wrapper.properties` now pins
`distributionUrl` to `gradle-9.6.0-bin.zip` explicitly, matching AGP
9.4.0's documented default. Sync and build succeeded immediately after.

## Historical note: Gradle could not run in the agent's sandboxed shell

Before Android Studio was used directly, every attempt to run Gradle
(including `gradle wrapper` itself) from the coding agent's Bash tool
failed with:

```
java.io.IOException: Unable to establish loopback connection
  at sun.nio.ch.PipeImpl$Initializer.run(...)
  at sun.nio.ch.WindowsSelectorImpl.<init>(...)  [or WEPollSelectorImpl]
  at java.nio.channels.Selector.open(...)
Caused by: java.net.SocketException: Invalid argument: connect
  at sun.nio.ch.UnixDomainSockets.connect0(Native Method)
```

Traced to a minimal 4-line Java program calling
`java.nio.channels.Selector.open()` directly — nothing Gradle-specific.
Confirmed not JDK-version-specific (same failure on JBR 25 and Temurin 21)
and not general loopback breakage (plain `ServerSocket`/`Socket` TCP works
fine in the same shell) — specifically an `AF_UNIX` domain socket
restriction in that sandboxed shell, below the JVM. **Opening the project
in Android Studio directly (a separate, non-sandboxed process) sidestepped
this entirely**, which is how the wrapper and the build above were
actually produced.

**Confirmed machine-specific, not platform-specific, 2026-09-08.** The same
4-line `Selector.open()` program succeeds without incident from a plain
Bash shell on macOS — `KQueueSelectorImpl`, no `AF_UNIX` wakeup pipe
involved at all — and `./gradlew build` completed there in one attempt once
`local.properties` pointed at the SDK. So this was never "agents can't run
Gradle"; it was one sandboxed shell's socket policy. Kept here for anyone
hitting the same wall from an equivalent restricted shell, now with the
counter-evidence that it is not universal.

## Protocol types

`app/src/main/kotlin/app/crossscreen/android/protocol/Protocol.kt` is
generated, not hand-written — architecture §65's promise that the Kotlin
client cannot drift from the wire protocol. Regenerate it after any change
to `packages/protocol/src`:

```bash
pnpm --filter @crossscreen/protocol generate:kotlin
```

`kotlinx.serialization` decodes it: `ClientMessage` and `ServerMessage` are
sealed interfaces with one nested class per wire `type`, discriminated on
that field by kotlinx.serialization's own default (`classDiscriminator =
"type"`, so no annotation or custom `Json` config is needed for that part).
Nested rather than top-level, on purpose — `rtc.offer` names a client
variant with `to` and a server variant with `from`, so
`ClientMessage.RtcOffer` and `ServerMessage.RtcOffer` need to be distinct
types, and nesting is what makes the identical simple name legal.

`ProtocolTest.kt` round-trips real envelope JSON through the generated
types — the discriminator, a required-but-nullable ICE field, an optional
field genuinely absent from the wire, and an unknown field from a
hypothetically newer server all decode correctly. Compiling proves none of
that; a passing test does.

**Not yet done:** CI does not fail if `Protocol.kt` drifts from the schema
(exit criterion 6's second half) — regeneration is a manual step, the same
as `generate:schema` already is for the JSON Schema files themselves.

## Screen capture: MediaProjection → foreground service → WebRTC VideoTrack

`capture/ScreenShareService.kt` is real, not mocked: Share Setup's "Start
Sharing" launches Android's actual `MediaProjectionManager` consent dialog
(`MainActivity.requestCapture()`), and only on real approval starts
`ScreenShareService` with the consent result as extras.

The service exists specifically to get one ordering right, in one place:
`startForeground()` — with `ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`
on API 29+ — runs as the *first* line of `onStartCommand()`, unconditionally,
before anything reaches `MediaProjectionManager.getMediaProjection()` (which
`ScreenCapturerAndroid.startCapture()` does internally). Android 14+ throws
`SecurityException` on the reverse order; this is the app's one and only
path into capture, so there is nowhere else the ordering could be gotten
wrong by a later change.

**The capture is now a WebRTC `VideoTrack`.** `org.webrtc`'s
`ScreenCapturerAndroid` (from the `io.github.webrtc-sdk:android` community
build — Google stopped publishing `org.webrtc` in 2019; this is the same
package, the one LiveKit and flutter-webrtc use) feeds a `VideoSource`
created with `isScreencast = true` — the screen-content coding path from
architecture §9, so text stays sharp under pressure rather than the
frame-rate-first behaviour tuned for cameras. The long edge is capped at
1920 and never upscaled. `ActiveSharingScreen` renders the resulting local
track in a `SurfaceViewRenderer` (`ui/components/VideoPreview.kt`) — the
same renderer the viewer side will use for the remote track, pointed at
the local one for now. That rendered preview *is* the proof the pipeline
works; there is no synthetic frame counter.

There is still **no `PeerConnection` and no signaling** — the track is
created, enabled, and rendered locally, nothing more. A phone-originated
session does not exist on the server for a peer to attach to.

`ScreenShareService.finishCapture()` is the single teardown path regardless
of trigger — the in-app "Stop Sharing" confirmation, the system's
kill-switch chip and Android 15 QPR1+'s screen-lock stop (both via the
`MediaProjection.Callback` handed to `ScreenCapturerAndroid`), a failed
start, or `onDestroy`. It is re-entrant-safe and always runs on the main
thread (the system callback posts to it). Every WebRTC handle is disposed
there in order. `MainActivity` distinguishes only "the user just confirmed
this" from everything else, to decide whether Home shows an explanation.

**Not yet verified by build.** Every actual Gradle task (`test`, `build`,
even `--no-daemon`) still fails in the coding agent's own Bash tool shell
with the `Unable to establish loopback connection` error described above —
confirmed again after the AGP/Gradle pin fix, for any task that forks a
build process; `./gradlew --version` alone now succeeds (no forked
process). So this WebRTC wiring was written against the `m144_release`
source (the `144.7559.x` line's exact `ScreenCapturerAndroid` /
`PeerConnectionFactory` / `SurfaceViewRenderer` signatures were checked
against it) and reviewed carefully, but has not compiled anywhere yet.
**Needs, before trusting it:** open in Android Studio (or `./gradlew
assembleDebug` from an unrestricted shell), sync — the first sync pulls
the ~80 MB WebRTC AAR — run on the Android 15 emulator, walk Share Setup →
grant the system capture-consent dialog → confirm Active Sharing shows a
live picture of the emulator's own screen in the preview box → Stop
Sharing → confirm it returns to Home. Then lock the emulator screen mid-share
and confirm it returns to Home with "The system stopped screen sharing".

## Signaling + WebRTC: net/

`net/` is the Kotlin counterpart of `packages/webrtc-core/`, cut to the
happy path:

- **`WebRtcCore`** — one `PeerConnectionFactory` + `EglBase` for the
  process (WebRTC requires a track and its `PeerConnection` come from the
  same factory).
- **`ApiClient`** — `POST /api/v1/sessions`, `GET /api/v1/ice-servers`, over
  OkHttp; ported from `api-client.ts`.
- **`SignalingClient`** — an OkHttp WebSocket speaking the `{ v, id, ts,
  payload }` envelope from `Protocol.kt`, decoded polymorphically on
  `"type"`. **No auto-reconnect yet** — the TS client's Phase 2 resume
  handling is a follow-up.
- **`SharerSession`** — create session → `session.host.attach` → on a
  pending viewer, show Allow/Decline → on approve, `PeerConnection` +
  `addTrack` + offer → answer → ICE. One viewer at a time; no stats,
  tuning, forced relay or ICE-restart recovery yet.
- **`ViewerSession`** — `session.viewer.request` by code → wait → answer
  the offer → render the remote track (`ViewerScreen`, screen A13).
- `IceCandidateQueue`, `RtcHelpers` (coroutine wrappers over the callback
  SDP API) round it out.

**Nothing here is build-verified.** The `org.webrtc` API surface used
(`RTCConfiguration`, `createPeerConnection`, `addTrack`, the `SdpObserver`
/ `PeerConnection.Observer` shapes) was checked against the `m144_release`
source, and kotlinx.serialization's polymorphic decode of the sealed
`ClientMessage`/`ServerMessage` is standard — but it has not compiled.
**To test the full loop:** dev stack + `pnpm tunnel` running, paste the
URL into Settings → Server on the phone, Share on the phone, open the
tunnel URL in a desktop browser, Join with the code, Allow on the phone,
confirm the browser shows the phone's screen. Then the reverse: Share in
the browser, Join on the phone.

## Next

Once the loop is confirmed: the reconnection + resume half of
`SignalingClient` (Phase 2's rule that a dropped socket must not cost a
session its code), stats reporting, and then CI enforcement that
`Protocol.kt` has not drifted from the schema (exit criterion 6's second
half).
