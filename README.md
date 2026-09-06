# CrossScreen

**Any Screen. Any Device. Together.**

Cross-platform, real-time screen sharing. Share your screen from a computer,
watch it in any browser — desktop, Android, or iOS — with nothing to install
on the viewer's side.

> **Status: Phase 1 code complete, Phase 2 started.** Not yet a product, but
> the full loop works: a screen shared from a browser or the desktop app
> reaches a viewer on another network, with host approval, over a direct path
> or a TURN relay. See [`docs/roadmap.md`](docs/roadmap.md) for what ships when.

### Picking this up on another machine

```bash
pnpm setup     # install, build, create .env.local files
pnpm dev       # signaling + web viewer + Electron sharer
```

**The Phase 0.5 gate passed in full on 2026-09-07**, relay included: a Mac
sharing to a phone on mobile data connected directly, and forcing the relay on
both the browser and the desktop app put the media through Cloudflare TURN.
Details, and the three silent misconfigurations that closing it uncovered, are
in [`docs/phases/phase-0.5-walking-skeleton.md`](docs/phases/phase-0.5-walking-skeleton.md).

**Next task: Phase 2 — reliability.** §2.2 (forced-relay mode) is done. The
rest is reconnection: surviving a Wi-Fi-to-mobile handover, a closed laptop
lid, a dropped signaling socket — none of which should ever cost someone their
session code. See [`docs/phases/phase-2-reliability.md`](docs/phases/phase-2-reliability.md).

To run the relay path yourself, create a Cloudflare TURN key and run
`pnpm turn` — the steps are in [`docs/dev-setup.md`](docs/dev-setup.md). Then
`pnpm tunnel`, `pnpm dev`, and open the printed URL on a phone **with Wi-Fi
off**.

Capture itself is no longer in question on either desktop platform. It is
verified on Windows 11 and on macOS 15.5 — ScreenCaptureKit, 2940x1912 at
30 fps — and an eleven-minute loopback run on the Mac held resolution and codec
steady without a drop. Run the check anyway on a machine or platform that has
not seen it, because macOS asks for Screen Recording permission the first time:

```bash
pnpm --filter @crossscreen/desktop run verify:capture
```

---

## What it does

1. The sharer opens CrossScreen and clicks **Start Sharing**.
2. They get a 6-digit code and a share link.
3. The viewer opens the link in any browser and requests to join.
4. The sharer approves, and the screen appears — over a direct
   peer-to-peer WebRTC connection where the network allows it, and over a
   TURN relay where it does not.

No port forwarding, no IP addresses, no accounts.

## Platform support

Sharing and viewing are **not** symmetric — this is the central constraint of
the product. See [`docs/platform-matrix.md`](docs/platform-matrix.md) for the
full detail and the evidence behind it.

|                                                     | Share           | View       |
| --------------------------------------------------- | --------------- | ---------- |
| Windows / macOS / Linux desktop app                 | ✅              | ✅         |
| Desktop browser (Chrome, Edge, Firefox, Safari 17+) | ✅              | ✅         |
| Android                                             | app — _planned_ | ✅ browser |
| iOS / iPadOS                                        | _deferred_      | ✅ browser |

Mobile browsers cannot capture a screen at all: `getDisplayMedia()` is
unavailable on iOS Safari and on Android Chrome. Mobile sharing therefore
requires a native app — there is no web workaround.

## Repository layout

```
apps/       web viewer · Electron desktop sharer · Android sharer
services/   api (Fastify) · signaling (WebSocket)
packages/   protocol · webrtc-core · capture · ui
docs/       architecture, platform matrix, ADRs, roadmap
tests/      end-to-end connection tests
```

`packages/protocol` is the single source of truth for every message on the
wire. TypeScript types and the Kotlin/Swift equivalents are generated from
the same JSON Schema so clients cannot drift apart.

## Documentation

| Document                                             | Contents                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)       | Full technical architecture v1.0                              |
| [`docs/platform-matrix.md`](docs/platform-matrix.md) | Per-OS capture capabilities and limits                        |
| [`docs/roadmap.md`](docs/roadmap.md)                 | Phases and scope at a glance                                  |
| [`docs/phases/`](docs/phases/)                       | A detailed plan per phase: scope, tasks, exit criteria, risks |
| [`docs/ui-scope.md`](docs/ui-scope.md)               | The design mockup reconciled against the architecture         |
| [`docs/dev-setup.md`](docs/dev-setup.md)             | Running it locally, and the Phase 0.5 cross-network test      |
| [`docs/adr/`](docs/adr/)                             | Architecture Decision Records                                 |

## Development

Requires Node.js 22 or newer and pnpm 11+. Node 26 removed corepack, so
install pnpm directly:

```bash
npm install -g pnpm
```

```bash
pnpm install
pnpm test
pnpm typecheck
```

CI runs on Node 24 (LTS).

## License

Not yet chosen.
