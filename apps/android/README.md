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
- `gradle/wrapper/gradle-wrapper.properties` exists (Android Studio wrote
  it on first sync) and is what the IDE reads to pick a Gradle
  distribution. **`gradlew`/`gradlew.bat`/`gradle-wrapper.jar` do not
  exist yet** — Android Studio's IDE-integrated sync uses its own Tooling
  API connection and never needed them. Command-line builds (`./gradlew
  build`, and CI) will need those generated first, by running `gradle
  wrapper` from a shell where Gradle can actually execute — not yet done.

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
actually produced. This note is kept for anyone hitting the same wall from
an equivalent sandboxed shell.

## Next

Foundation confirmed to compile and run. Next slice of Phase 4 work:
Kotlin protocol types generated from `packages/protocol/schema/`, then
`MediaProjection` capture, then `org.webrtc` wiring, then the foreground
service with correct Android 14+ start ordering.
