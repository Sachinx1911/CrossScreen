# Development Setup

## Prerequisites

- **Node.js 22 or newer.** Node 26 removed corepack, so install pnpm directly:
  `npm install -g pnpm`
- **pnpm 11+**
- A second device on a **different network** for the Phase 0.5 gate — a phone
  on mobile data is ideal, because it is the case most likely to fail.

```bash
pnpm install
pnpm typecheck && pnpm test
```

Dependency install scripts are blocked by default in `pnpm-workspace.yaml`.
Two are allowed deliberately: `esbuild` (places the Vite binary) and
`electron` (downloads the Chromium runtime). Adding a third is a decision, not
a convenience — each one is an arbitrary command from a third party.

## Verifying the desktop capture assumption

Before anything else, confirm the claim ADR-0002 rests on — that Electron
routes `getDisplayMedia()` to the platform's native capture backend:

```bash
pnpm --filter @crossscreen/desktop run verify:capture
```

It prints what it captured and exits non-zero on failure. **Run this on every
new platform and after every major Electron upgrade.** If it fails, the desktop
architecture is wrong and nothing built on top of it is safe.

Verified so far:

| Platform                    | Result      | Details                                                                      |
| --------------------------- | ----------- | ---------------------------------------------------------------------------- |
| Windows 11, Electron 44.2.0 | ✅ PASS     | Windows Graphics Capture, 1920x1080 @ 30 fps, `contentHint: 'text'` accepted |
| macOS 13+                   | not yet run | Phase 3b                                                                     |
| Linux GNOME/KDE             | not yet run | Phase 3b                                                                     |

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

## The Phase 0.5 cross-network test

This is the **GO/NO-GO gate**. Local success proves nothing about NAT traversal.

### 1. Expose the signaling server

`localhost` is not reachable from another network, so put a tunnel in front:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

It prints a public `https://…trycloudflare.com` URL. The WebSocket URL is the
same host with `wss://`.

### 2. Point both ends at it

`apps/web/.env.local` and `apps/desktop/.env.local`:

```
VITE_SIGNALING_URL=wss://your-tunnel-hostname.trycloudflare.com
```

The tunnel hostname changes every restart, which is why it is configuration
rather than code, and why `.env.local` is not committed.

### 3. Run the test

1. Start the signaling server and the tunnel on the sharing machine.
2. Start the desktop app there and press **Start Sharing**.
3. On the second device, **on a different network**, open the web viewer.
4. Watch the stats line on both ends.

### 4. Prove the relay path separately

P2P succeeding is not proof that TURN works, and a TURN path that has never
been exercised is a TURN path that does not work. Force it:

- **Viewer:** append `?relay=1` to the URL.
- **Sharer:** set `VITE_FORCE_RELAY=1` and rebuild.

This needs real TURN credentials in `.env.local` — see `.env.example`. Cloudflare
Realtime TURN is free for the first 1 TB per month (ADR-0004).

### 5. Record the result

The five exit criteria are in
[`phases/phase-0.5-walking-skeleton.md`](phases/phase-0.5-walking-skeleton.md).
Write down time to first frame, round-trip time, transport, and codec — every
later performance claim is measured against this baseline, so an unrecorded
run is a run half wasted.

## Environment variables

| Variable               | Used by      | Purpose                               |
| ---------------------- | ------------ | ------------------------------------- |
| `SIGNALING_PORT`       | signaling    | Listen port (default 8787)            |
| `SIGNALING_HOST`       | signaling    | Bind address (default 127.0.0.1)      |
| `LOG_LEVEL`            | signaling    | `debug`, `info`, `warn`, `error`      |
| `VITE_SIGNALING_URL`   | web, desktop | WebSocket URL of the signaling server |
| `VITE_TURN_URLS`       | web, desktop | Comma-separated TURN URLs             |
| `VITE_TURN_USERNAME`   | web, desktop | TURN username                         |
| `VITE_TURN_CREDENTIAL` | web, desktop | TURN credential                       |
| `VITE_FORCE_RELAY`     | desktop      | `1` pins ICE to relay only            |

> **Disclosed shortcut.** Build-time TURN credentials are Phase 0.5 only. Phase 2
> replaces them with `GET /api/v1/ice-servers` issuing short-lived credentials,
> so that no client ever ships a long-lived secret (ADR-0004).
