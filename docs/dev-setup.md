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
> not fetch the Electron runtime despite `electron: true` in `allowBuilds`, so
> the first `verify:capture` spent its entire 20-second budget downloading
> Chromium, and `desktopCapturer.getSources()` rejected with
> `Failed to get sources`. That message is indistinguishable from the missing
> Screen Recording permission, which is the failure everyone expects on a Mac,
> so the obvious reading sent us into System Settings to fix something that was
> never wrong.
>
> `pnpm setup` now checks for the runtime and fetches it if it is missing, so
> this should not happen again. If you meet it anyway — after an install that
> did not go through `pnpm setup`, say — run `pnpm setup`, and note that
> `pnpm rebuild electron` is not the fix: it exits silently having done
> nothing, because pnpm already considers the package built.

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

## End-to-end tests

```bash
pnpm test:e2e
```

Eight tests drive the real loop across two browser contexts and three servers.
They run in Chromium by default. To run the other engines as well:

```bash
E2E_ALL_BROWSERS=1 pnpm test:e2e
```

What that produced on Windows, 2026-09-06 — worth knowing before reading
anything into a red run:

| Engine   | Result                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium | 8 of 8 pass                                                                                                                                                                                                               |
| Firefox  | Does not launch at all (`spawn UNKNOWN`). An environment problem on this machine; nothing about the application was exercised                                                                                             |
| WebKit   | The two tests needing no WebRTC pass; the six that negotiate a peer connection time out. Playwright's WebKit is not Safari and its WebRTC support is thinner, so this is weak evidence about Safari rather than a finding |

Safari is answered properly by running the flow on real macOS, which is now
available. Firefox needs a machine where Playwright can start it.

## The database, optionally

Session events and connection statistics go to PostgreSQL. It is **optional in
development**: without `DATABASE_URL` each service runs with a no-op recorder
and says so once at startup, so a fresh clone works with nothing installed.

To run it:

```bash
docker compose -f infrastructure/docker-compose.dev.yml up -d
```

```bash
DATABASE_URL=postgres://crossscreen:crossscreen@localhost:5432/crossscreen pnpm --filter @crossscreen/db migrate
```

Then start the services with the same `DATABASE_URL`.

The query this exists to answer first, and the reason Phase 2 needs it — what
fraction of connections went direct rather than through a relay, which is what
predicts TURN cost (ADR-0004):

```sql
SELECT transport, count(*), round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM connection_stats
WHERE occurred_at > now() - interval '7 days'
GROUP BY transport;
```

Verified against PostgreSQL 17 on 2026-09-06: migrations apply, all four
tables are created, and a full share-and-join run lands session events and
connection statistics that the query above can actually read.

### Retention

`session_events` and `connection_stats` fill up at one row per connection
per couple of seconds, so nothing in this project ever asked the database to
keep all of it forever (phase-3a-production.md §3.3). Run this on a schedule
— a daily cron job or systemd timer in production, whenever in development:

```bash
DATABASE_URL=postgres://crossscreen:crossscreen@localhost:5432/crossscreen pnpm --filter @crossscreen/db retention
```

Deletes anything older than `DATA_RETENTION_DAYS` (default 30) from
`session_events`, `connection_stats` and `abuse_log`. The script does one
pass and exits — it is not a daemon, and does not schedule itself.

### The rest of what 2.4 asks for

`connection_stats` and `session_events` between them are meant to answer every
question about a failed session without asking anyone to reproduce it. The
direct-versus-relay query above is one of four; these are the others.

**Time to connect, median and p95.** The `connected` session event is written
once per connection — the first `stats.report` naming `connectionState:
'connected'`, not every one of the reports that keep arriving after — measured
against `created`, which is the one baseline every session has regardless of
whether a host or a viewer is the side being measured:

```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY connected_at - created_at) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY connected_at - created_at) AS p95
FROM (
  SELECT
    c.session_id,
    c.occurred_at AS created_at,
    min(e.occurred_at) AS connected_at
  FROM session_events c
  JOIN session_events e ON e.session_id = c.session_id AND e.event = 'connected'
  WHERE c.event = 'created' AND c.occurred_at > now() - interval '7 days'
  GROUP BY c.session_id, c.occurred_at
) t;
```

**Failure reasons, grouped.** Two different things end up here on purpose: why
a session ended at all (`session_events`, `event = 'ended'`, which already
distinguishes `host_ended` / `expired` / `idle_timeout`), and where a live
connection itself reported `failed` before anyone closed anything
(`connection_stats.connection_state`):

```sql
SELECT detail->>'reason' AS reason, count(*)
FROM session_events
WHERE event = 'ended' AND occurred_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;

SELECT transport, count(*)
FROM connection_stats
WHERE connection_state = 'failed' AND occurred_at > now() - interval '7 days'
GROUP BY transport;
```

**Round-trip time, packet loss, bitrate, resolution, frame rate, codec for one
session** — the question asked while looking at a specific report of "it was
bad," which is what makes this table worth having at all:

```sql
SELECT occurred_at, transport, quality, connection_state,
       round_trip_ms, packet_loss_pct, bitrate_kbps,
       resolution, frames_per_second, codec
FROM connection_stats
WHERE session_id = $1
ORDER BY occurred_at;
```

**Not verified against a live database this session** — the migration
(`002_stats_pipeline.sql`) is three additive `ALTER TABLE ADD COLUMN`
statements following the same shape as the ones in `001` that already ran
clean, and the handler logic that fills them (`packetLossPct`, `bitrateKbps`,
`connectionState`, the one-time `connected` event) is covered by
`services/signaling/src/handlers.test.ts` against a fake recorder. What is not
yet re-proven is these queries actually reading back rows from a real
Postgres, the way the direct-versus-relay one above was on 2026-09-06 — worth
doing the next time this machine has Docker Desktop running.

## Stale servers

`pnpm dev` frees its own ports first, so this should not need attention. It is
worth knowing why it does.

Ctrl+C does not reliably take Vite down with it. A stale server keeps its port,
and the next `pnpm dev` quietly moves to the following free number — 5174, then 5175. The page at 5173 still loads, still looks correct, and is an hour-old
build. That happened, and cost an hour of looking for a bug in code that was
never running.

To free them by hand:

```bash
pnpm dev:free-ports
```

It names each process it stops. No output means nothing was stale.

> `Get-NetTCPConnection` treats "nothing found" as an error and prints a wall of
> red for the ordinary case, which is why the script uses `netstat` instead.

## Sessions do not survive a restart

Live sessions are held in the signaling service's memory (ADR-0005), so
restarting it ends every one of them and their join codes stop resolving. Both
ends now say the connection was lost rather than leaving a dead code on screen,
but a code from before a restart will never work again. Start a new share.

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

- **Browser (share or join):** append `?relay=1` to the URL — `/share?relay=1`
  or `/j/<token>?relay=1`. No rebuild needed, same reason a fresh tab needs
  none for anything else.
- **Desktop (share or join):** set `VITE_FORCE_RELAY=1` and restart. A build-time
  flag here rather than a query parameter, because this window is never
  reached by navigating to a fresh URL.

All four now refuse to start and say so rather than connecting and failing
with nothing to go on: forcing the relay discards every candidate that is not
a relay candidate, so with no TURN server ICE gathers nothing at all and gives
up. That looks exactly like the genuine no-path failure this gate exists to
investigate, which makes "TURN is broken" the obvious and wrong conclusion —
and a typo in one credential produces the same silence. (`packages/webrtc-core`
had carried the check — `hasTurnServer`, fully unit-tested — for a while
without either session ever calling it; fixed 2026-09-07, and now proven by an
end-to-end test rather than only a unit one.)

TURN needs a Cloudflare key, and `pnpm turn` sets it up:

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

It copies both into `services/api/.env.local`. **Restart `pnpm dev` once**
afterwards, so the API service picks up the key — from then on, it mints its
own short-lived credential (`TURN_CREDENTIAL_TTL_SECONDS`, four hours by
default) from that key on every `GET /api/v1/ice-servers` call, cached until
shortly before it expires (`services/api/src/turn.ts`), with no further
restarts needed.

No client ever ships a TURN secret: the apps ask that endpoint rather than
carrying credentials in their own build, and the long-term Cloudflare key never
reaches a client at all — only the short-lived credential minted from it does.

> Until 2026-09-07 this script wrote `VITE_TURN_*` into the web and desktop
> apps' `.env.local` instead — left over from before the endpoint existed.
> Nothing had read those variables since Phase 1, so it printed success and
> configured nothing, and forced-relay runs failed for what looked like a TURN
> problem. If a stale `VITE_TURN_*` line is still sitting in either app's
> `.env.local`, it does nothing and can be deleted.

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

| Variable                       | Used by               | Purpose                                                 |
| ------------------------------ | --------------------- | ------------------------------------------------------- |
| `SIGNALING_PORT`               | signaling             | Listen port (default 8787)                              |
| `SIGNALING_HOST`               | signaling             | Bind address (default 127.0.0.1)                        |
| `LOG_LEVEL`                    | signaling             | `debug`, `info`, `warn`, `error`                        |
| `SIGNALING_TARGET`             | web dev server        | Where `/ws` is proxied (default `ws://127.0.0.1:8787`)  |
| `VITE_SIGNALING_URL`           | web, desktop          | WebSocket URL of the signaling server                   |
| `CLOUDFLARE_TURN_KEY_ID`       | api                   | Long-term Cloudflare key; mints short-lived credentials |
| `CLOUDFLARE_TURN_API_TOKEN`    | api                   | Paired with the key id above                            |
| `TURN_CREDENTIAL_TTL_SECONDS`  | api                   | How long a minted credential lasts (default 4 hours)    |
| `VITE_FORCE_RELAY`             | desktop               | `1` pins ICE to relay only                              |
| `VITE_AUTOSTART`               | desktop               | `1` starts sharing without a click                      |
| `CROSSSCREEN_SIGNALING_URL`    | desktop main          | Overrides `.tunnel-url` at launch                       |
| `SENTRY_DSN`                   | api, signaling        | Where errors are reported; unset means logged only      |
| `VITE_SENTRY_DSN`              | web, desktop renderer | Same, for the two browser-side surfaces                 |
| `RATE_LIMIT_CODE_PER_MINUTE`   | signaling             | Join attempts per address (default 5)                   |
| `RATE_LIMIT_CODE_PER_HOUR`     | signaling             | Same, hourly (default 20)                               |
| `RATE_LIMIT_SESSIONS_PER_HOUR` | api                   | Session creations per address per hour (default 20)     |

> **`VITE_AUTOSTART` shares your screen the moment the app opens.** It exists so
> a scripted run does not need someone to press a button, and it is why the
> capture and renderer probes can be automated. Do not leave it set in a
> `.env.local` you use day to day: a sharer that starts without an explicit
> action is the one thing this product must never be.

**The desktop app's main process reads `SENTRY_DSN` as a raw OS environment
variable, not from `.env.local`.** It is the only surface that does — main is
compiled by plain `tsc`, not bundled by Vite, so there is no `import.meta.env`
to read there, and nothing loads a `.env` file into it today
(`CROSSSCREEN_SIGNALING_URL` is the existing precedent for this same
limitation). The renderer's own `VITE_SENTRY_DSN` works exactly like
`VITE_FORCE_RELAY` already does.

**Changing the port takes two variables, not one.** `SIGNALING_PORT` moves the
server; the viewer then reaches it either directly through `VITE_SIGNALING_URL`
or through the dev server's `/ws` proxy, whose target is `SIGNALING_TARGET`.
Move the port without the one the viewer actually uses and the page loads
perfectly and never connects.

> **Disclosed shortcut.** Build-time TURN credentials are Phase 0.5 only. Phase 2
> replaces them with `GET /api/v1/ice-servers` issuing short-lived credentials,
> so that no client ever ships a long-lived secret (ADR-0004).
