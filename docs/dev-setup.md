# Development Setup

## Prerequisites

- **Node.js 22 or newer.** Node 26 removed corepack, so install pnpm directly:
  `npm install -g pnpm`
- **pnpm 11+**
- A second device on a **different network** for the Phase 0.5 gate — a phone
  on mobile data is ideal, because it is the case most likely to fail.

```bash
pnpm setup
```

That installs dependencies, builds the workspace packages, and creates the
`.env.local` files from their examples. Then:

```bash
pnpm typecheck && pnpm test
```

> **The build step is not optional on a fresh clone.** ESLint's type-aware
> rules resolve workspace imports through the generated declaration files, so
> linting a clone that has never been built fails with "could not be resolved"
> rather than anything useful. `pnpm lint` therefore builds first, and turbo
> caches it so repeat runs cost nothing.

Dependency install scripts are blocked by default in `pnpm-workspace.yaml`.
Two are allowed deliberately: `esbuild` (places the Vite binary) and
`electron` (downloads the Chromium runtime). Adding a third is a decision, not
a convenience — each one is an arbitrary command from a third party.

## Starting from a fresh clone

```bash
git clone https://github.com/Sachinx1911/CrossScreen.git
cd CrossScreen
pnpm setup
```

`pnpm setup` installs, builds, and creates the `.env.local` files. If `pnpm` is
missing, `npm install -g pnpm` — Node 26 dropped corepack, so it is a direct
install now.

Then confirm this machine can capture at all:

```bash
pnpm --filter @crossscreen/desktop run verify:capture
```

### macOS, first run

The Screen Recording permission is the awkward part, and it catches everyone:

1. The first capture attempt triggers the system prompt. Allow it.
2. **Quit and restart the app.** macOS does not apply the grant to a process
   that is already running, so the first run after granting still fails. This
   is normal, and it is why Phase 3b treats the permission flow as the real
   work rather than the capture itself.
3. If no prompt appears, or capture returns black frames, open **System
   Settings → Privacy & Security → Screen Recording** and enable **Electron**.
   In development the binary is unpackaged, so it appears under that name
   rather than CrossScreen. Depending on how it was launched, the terminal app
   may need enabling too.

Run `verify:capture` again afterwards. It should print the capture size and
`PASS`.

## Working across two machines

This project moves between a Windows PC and a Mac over git. Three things are
deliberately not committed and must be recreated on each machine — `pnpm setup`
does all three:

| Not in git      | Why                                                    | Recreated by               |
| --------------- | ------------------------------------------------------ | -------------------------- |
| `node_modules/` | Platform-specific binaries, Electron among them        | `pnpm install`             |
| `dist/`         | Build output; also what the type-aware lint rules read | `pnpm build`               |
| `.env.local`    | Machine-specific, and the tunnel URL changes every run | copied from `.env.example` |

Line endings are normalised to LF by `.gitattributes`, so no file should ever
appear modified purely from switching machines. If one does, that is a bug in
the attributes rather than something to work around.

**On the Mac, run `verify:capture` first.** It is the only thing that confirms
Chromium's ScreenCaptureKit path works there, and macOS asks for Screen
Recording permission the first time — the app has to be restarted after
granting it before capture actually starts working. A user who is not told that
concludes the product is broken, which is why Phase 3b treats the permission
flow as the real work rather than the capture itself.

Having both machines also unblocks two things the plan assumed would wait:
the cross-network gate below, and the macOS half of
[Phase 3b](phases/phase-3b-macos-linux.md).

## Verifying the desktop capture assumption

Before anything else, confirm the claim ADR-0002 rests on — that Electron
routes `getDisplayMedia()` to the platform's native capture backend:

```bash
pnpm --filter @crossscreen/desktop run verify:capture
```

It prints what it captured and exits non-zero on failure. **Run this on every
new platform and after every major Electron upgrade.** If it fails, the desktop
architecture is wrong and nothing built on top of it is safe.

A second probe checks the renderer itself:

```bash
pnpm --filter @crossscreen/desktop run verify:renderer
```

It confirms the page runs under its own Content-Security-Policy, in a secure
context, with the bundle actually executing. Both failures it guards against
were silent when we hit them: a blocked script leaves a page that looks
completely normal, and outside a secure context `navigator.mediaDevices` is
`undefined` rather than empty.

Verified so far:

| Platform                    | Result      | Details                                                                      |
| --------------------------- | ----------- | ---------------------------------------------------------------------------- |
| Windows 11, Electron 44.2.0 | ✅ PASS     | Windows Graphics Capture, 1920x1080 @ 30 fps, `contentHint: 'text'` accepted |
| macOS 15.5, Electron 44.2.0 | ✅ PASS     | ScreenCaptureKit, 2940x1912 @ 30 fps, `contentHint: 'text'` accepted         |
| Linux GNOME/KDE             | not yet run | Phase 3b                                                                     |

`verify:renderer` also passes on macOS: origin `app://bundle`, secure context,
zero CSP violations.

> **The first macOS run failed for a reason worth knowing.** `pnpm install` did
> not fetch the Electron binary despite `electron: true` in `allowBuilds`, so
> the first `verify:capture` spent its entire 20-second budget downloading
> Chromium, and `desktopCapturer.getSources()` rejected with
> `Failed to get sources`. That message is indistinguishable from the missing
> Screen Recording permission, which is the failure everyone expects on a Mac —
> so the obvious reading was the wrong one. If a first run on a fresh clone
> fails that way,
> **run it a second time before touching System Settings.** To rule it out up
> front: `pnpm rebuild electron`, or check that
> `node_modules/.pnpm/electron@*/node_modules/electron/dist` exists.

## Running the walking skeleton locally

One command starts all three:

```bash
pnpm dev
```

It builds the shared packages first, then runs the signaling server, the Vite
dev server and the Electron app together, with their output interleaved and
prefixed. Ctrl+C stops all of them.

Then open the viewer URL that Vite prints and press **Start Sharing** in the
desktop window. The screen should appear in the browser.

> **Each of these is a long-running process.** Started individually
> (`pnpm dev:signaling`, `pnpm dev:web`, `pnpm dev:desktop`) they each need
> their own terminal — typing the next command into a terminal already running
> Vite sends it to Vite's input rather than the shell, and nothing happens. Both ends print a stats line every two
> seconds:

```
transport=direct path=host->host rtt=1ms res=1920x1080 fps=30 codec=VP9
```

`transport` is the line that matters. Locally it will say `direct`; the point
of the cross-network test is to see what it says when the two machines are not
on the same network.

## Freeing a stuck port

The signaling server refuses to start if something already holds its port, and
reports it rather than crashing:

```
{"level":"error","event":"signaling.port_in_use","port":8787,...}
```

A stray `node --watch` left over from an earlier session is the usual cause.
On Windows:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Or sidestep it entirely:

```bash
SIGNALING_PORT=8788 pnpm dev:signaling
```

remembering to point `VITE_SIGNALING_URL` at the same port.

A port that is not a whole number, or is outside 1–65535, is now refused with
a `signaling.bad_config` line naming the variable and the value. `8788x` used
to be read as `8788`, so the server listened somewhere other than where the
person thought — with `VITE_SIGNALING_URL` still aimed at the port they meant.

## The Phase 0.5 cross-network test

This is the **GO/NO-GO gate**. Local success proves nothing about NAT traversal.

### 1. Install cloudflared, once

```powershell
winget install --id Cloudflare.cloudflared
```

macOS: `brew install cloudflared`. Open a **new terminal** afterwards, or the
old one will not have it on PATH.

### 2. Start the tunnel

```bash
pnpm tunnel
```

One tunnel covers both the viewer page and signaling, because the Vite dev
server proxies `/ws` through to the signaling port. The script prints the URL
to open on the phone, and writes the matching `wss://…/ws` to `.tunnel-url`,
which the desktop app reads at launch.

So there is **nothing to edit and nothing to rebuild**, even though a quick
tunnel gets a new hostname on every run. The viewer needs no configuration
either — it falls back to same-origin `/ws`, which works locally and through
the tunnel alike.

Both claims are verified on macOS, 2026-09-06, with cloudflared 2026.8.3: the
desktop app logged `[main] signaling override: wss://…/ws` read straight from
`.tunnel-url`, the viewer loaded over the public HTTPS hostname and reached
signaling through its own origin with nothing configured, and the media path
came up at `res=2940x1912 codec=VP9`. Restarting the sharer with the viewer
left open reconnected cleanly.

That is the whole rig except the two things it cannot stand in for: a second
network, and TURN. Both ends were on one machine, so `transport` says `direct`
and the media never went near the tunnel — which is the point, and why this
run is preparation for the gate rather than part of it.

Leave it running, and in another terminal:

```bash
pnpm dev
```

### 3. Run the test

1. Press **Start Sharing** in the desktop window.
2. On your phone, **turn Wi-Fi off so it is on mobile data**, and open the
   tunnel URL.
3. Watch the stats line at the bottom of the viewer.

Mobile data is the point. Two devices on the same Wi-Fi tell you nothing about
NAT traversal, which is the entire reason this gate exists.

### 4. Prove the relay path separately

P2P succeeding is not proof that TURN works, and a TURN path that has never
been exercised is a TURN path that does not work. Force it:

- **Viewer:** append `?relay=1` to the URL.
- **Sharer:** set `VITE_FORCE_RELAY=1` and restart.

Either one without TURN credentials now refuses to start and says so. It used
to connect and then fail with nothing to go on: forcing the relay discards
every candidate that is not a relay candidate, so with no TURN server ICE
gathers nothing at all and gives up. That looks exactly like the genuine
no-path failure this gate exists to investigate, which makes "TURN is broken"
the obvious and wrong conclusion — and a typo in one credential produces the
same silence.

TURN credentials are required, and `pnpm turn` fetches them:

1. **dash.cloudflare.com → Realtime → TURN Keys → Create.** Free, and the
   first 1 TB per month costs nothing (ADR-0004).
2. Put the two values in `.env.turn` at the repository root — it is gitignored,
   and the token must not go anywhere else:

   ```
   CLOUDFLARE_TURN_KEY_ID=...
   CLOUDFLARE_TURN_API_TOKEN=...
   ```

3. ```bash
   pnpm turn
   ```

It writes short-lived credentials into both apps' `.env.local`. The long-term
key never leaves this machine — the same arrangement Phase 2's
`GET /api/v1/ice-servers` endpoint formalises, so no client ever ships a
long-lived secret.

> **Not optional.** The first cross-network attempt failed outright: a PC and a
> phone on mobile data could find no direct path, and with no relay configured
> the connection simply failed. See
> [phase-0.5](phases/phase-0.5-walking-skeleton.md).

### 5. Record the result

The five exit criteria are in
[`phases/phase-0.5-walking-skeleton.md`](phases/phase-0.5-walking-skeleton.md).
Write down time to first frame, round-trip time, transport, and codec — every
later performance claim is measured against this baseline, so an unrecorded
run is a run half wasted.

## Environment variables

| Variable                    | Used by        | Purpose                                                |
| --------------------------- | -------------- | ------------------------------------------------------ |
| `SIGNALING_PORT`            | signaling      | Listen port (default 8787)                             |
| `SIGNALING_HOST`            | signaling      | Bind address (default 127.0.0.1)                       |
| `LOG_LEVEL`                 | signaling      | `debug`, `info`, `warn`, `error`                       |
| `SIGNALING_TARGET`          | web dev server | Where `/ws` is proxied (default `ws://127.0.0.1:8787`) |
| `VITE_SIGNALING_URL`        | web, desktop   | WebSocket URL of the signaling server                  |
| `VITE_TURN_URLS`            | web, desktop   | Comma-separated TURN URLs                              |
| `VITE_TURN_USERNAME`        | web, desktop   | TURN username                                          |
| `VITE_TURN_CREDENTIAL`      | web, desktop   | TURN credential                                        |
| `VITE_FORCE_RELAY`          | desktop        | `1` pins ICE to relay only                             |
| `VITE_AUTOSTART`            | desktop        | `1` starts sharing without a click                     |
| `CROSSSCREEN_SIGNALING_URL` | desktop main   | Overrides `.tunnel-url` at launch                      |

> **`VITE_AUTOSTART` shares your screen the moment the app opens.** It exists so
> a scripted run does not need someone to press a button, and it is why the
> capture and renderer probes can be automated. Do not leave it set in a
> `.env.local` you use day to day: a sharer that starts without an explicit
> action is the one thing this product must never be.

**Changing the port takes two variables, not one.** `SIGNALING_PORT` moves the
server; the viewer then reaches it either directly through `VITE_SIGNALING_URL`
or through the dev server's `/ws` proxy, whose target is `SIGNALING_TARGET`.
Move the port without the one the viewer actually uses and the page loads
perfectly and never connects.

> **Disclosed shortcut.** Build-time TURN credentials are Phase 0.5 only. Phase 2
> replaces them with `GET /api/v1/ice-servers` issuing short-lived credentials,
> so that no client ever ships a long-lived secret (ADR-0004).
