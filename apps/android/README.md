# CrossScreen — Android

Phase 4's walking skeleton: a Gradle/Kotlin project with two placeholder
screens (Share, Join), Jetpack Compose, nothing wired to `MediaProjection`
or `org.webrtc` yet on purpose — the same order Phase 0.5 held the rest of
this project to: prove the toolchain before building a feature on it.

**Status: builds and runs.** Verified 2026-09-08 on an Android 15
(`google_apis`, x86_64) emulator via Android Studio — the home screen
(`CrossScreen` / "Share your screen" / "Join a session") renders correctly.

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

## Screen capture: MediaProjection + foreground service

`capture/ScreenShareService.kt` is real, not mocked: Share Setup's "Start
Sharing" now launches Android's actual `MediaProjectionManager` consent
dialog (`MainActivity.requestCapture()`), and only on real approval starts
`ScreenShareService` with the consent result as extras.

The service exists specifically to get one ordering right, in one place:
`startForeground()` — with `ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`
on API 29+ — runs as the *first* line of `onStartCommand()`, unconditionally,
before `MediaProjectionManager.getMediaProjection()` is ever reached. Android
14+ throws `SecurityException` on the reverse order; this is the app's one
and only path to `getMediaProjection()`, so there is nowhere else the
ordering could be gotten wrong by a later change.

Deliberately stops short of `org.webrtc`. What it proves instead: real
frames exist. A `VirtualDisplay` backed by the projection feeds a plain
`ImageReader`, which counts frames on a background `HandlerThread` — no
`VideoCapturer`, no `PeerConnectionFactory`, nothing WebRTC-shaped yet. The
count surfaces on `ActiveSharingScreen` ("N frames captured") specifically
so it can be watched increase against a real screen, not trusted on faith.

`MediaProjection.Callback.onStop()` is the single teardown path regardless
of who ends the session — the in-app "Stop Sharing" confirmation
(`ScreenShareService.stopCapture()` calls `MediaProjection.stop()`, which
triggers the same callback), the system's own kill-switch chip, or Android
15 QPR1+'s screen-lock behaviour. `MainActivity` distinguishes the first
case from the other two only to decide whether Home shows an explanation —
an expected stop the user just confirmed shows nothing; every other stop
shows its reason, in place ahead of a real signaling connection existing
to report `CAPTURE_STOPPED_BY_SYSTEM` over.

**Not yet verified by build.** Every actual Gradle task (`test`, `build`,
even `--no-daemon`) still fails in the coding agent's own Bash tool shell
with the exact `Unable to establish loopback connection` error described
above — confirmed again on 2026-09-09, after the AGP/Gradle pin fix,
specifically for tasks that fork a build process; `./gradlew --version`
alone now succeeds (it needs no forked process), which is what changed,
not the underlying restriction. This capture code was written and
reviewed carefully but has not compiled anywhere yet. **Needs, before
trusting it:** open in Android Studio (or run `./gradlew build` from an
unrestricted shell), sync, run on the Android 15 emulator, walk Share
Setup → grant the system capture-consent dialog → confirm the frame count
on Active Sharing actually increases → Stop Sharing → confirm it returns
to Home. A camera/screen-recording-capable emulator image is required —
the existing `google_apis` Android 15 image already installed for this
project qualifies.

## Next

Toolchain proven, command-line builds work, protocol types generated and
tested, and `MediaProjection` capture is written (pending the build
verification above). Next slice of Phase 4 work: `org.webrtc` wiring — a
`VideoTrack` from the frames this service already produces, then a real
`PeerConnection` over the existing signaling protocol.
