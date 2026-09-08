# CrossScreen — Android

Phase 4's walking skeleton: a Gradle/Kotlin project with two placeholder
screens (Share, Join), Jetpack Compose, nothing wired to `MediaProjection`
or `org.webrtc` yet on purpose — the same order Phase 0.5 held the rest of
this project to: prove the toolchain before building a feature on it.

**Status: written, not yet built.** Read this before trusting anything
under `app/`.

## What is actually verified

- The Android SDK is installed and works: `adb version` reports
  1.0.41/37.0.1, `platforms;android-37.0` and `build-tools;36.0.0` are
  present, and `system-images;android-35;google_apis;x86_64` (Android 15,
  the version phase-4-android.md calls out for its screen-lock-stops-capture
  behaviour) installed successfully.
- Android Studio's bundled JBR (`Java 25`, at `Android Studio/jbr`) starts
  and reports its version correctly.
- The Android Gradle command-line tools (`sdkmanager`, `avdmanager`) were
  downloaded and used successfully to install the above.

## What is not verified, and why

**No Gradle command has ever run to completion in this environment** — not
`gradle wrapper`, not a build, nothing. Every attempt fails identically:

```
java.io.IOException: Unable to establish loopback connection
  at sun.nio.ch.PipeImpl$Initializer.run(...)
  at sun.nio.ch.WindowsSelectorImpl.<init>(...)  [or WEPollSelectorImpl]
  at java.nio.channels.Selector.open(...)
Caused by: java.net.SocketException: Invalid argument: connect
  at sun.nio.ch.UnixDomainSockets.connect0(Native Method)
```

Traced down to a minimal 4-line Java program calling
`java.nio.channels.Selector.open()` directly — nothing Gradle-specific.
Modern JDKs (confirmed on both JBR 25 and Temurin 21 — this is not a JDK
version issue) implement `Selector`'s internal wakeup pipe on Windows using
an `AF_UNIX` domain socket, and that specific `connect()` call fails in
this sandboxed shell with "Invalid argument" — a low-level Winsock error,
not a Java one. Forcing the classic `WindowsSelectorProvider` instead of
the newer `WEPollSelectorProvider` changes which class opens the pipe but
not the outcome: both go through the same `PipeImpl` code path underneath.

Plain TCP loopback sockets (`ServerSocket`/`Socket`) work fine in this same
shell — this is specifically about `AF_UNIX`, not loopback networking in
general. Whatever restricts it appears to sit below the JVM, in this
sandboxed shell's own environment (the same category of gap that stopped
Docker Desktop's named pipe from connecting during this project's Phase 3a
work) — not something a JVM flag was found to route around.

**Practically: any JVM program using NIO selectors — which is effectively
every modern build tool — cannot run from this particular shell.** Gradle
needs a working `Selector` even in `--no-daemon` mode, since the build
process it forks still communicates with the launcher over one.

## What to do next

**Open this directory in Android Studio directly**, not through this
shell. The IDE's own Gradle integration is a different process, launched
by you rather than spawned from this sandboxed shell, and may not hit the
same restriction — that is the next thing worth actually finding out.
Opening the project will also generate the Gradle wrapper
(`gradlew`/`gradlew.bat`/`gradle/wrapper/`), which is deliberately **not**
committed here yet: writing wrapper files by hand without ever running
`gradle wrapper` to produce them would mean guessing at a binary jar's
contents, which is a worse kind of unverified than simply not having it.

If Android Studio's own build also fails with the same "Unable to
establish loopback connection" error, that rules out this being specific
to the sandboxed shell and points at something machine-wide — worth
reporting back either way.

## Once a build succeeds

Report back what happened (built cleanly / built with warnings / failed
with what error) so `docs/phases/phase-4-android.md` can record real
status instead of this file's disclosed uncertainty, and so the actual
next slice of work — Kotlin protocol types generated from
`packages/protocol/schema/`, then `MediaProjection`, then `org.webrtc` —
has a foundation confirmed to compile before anything is built on it.
