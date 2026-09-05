# CrossScreen

**Any Screen. Any Device. Together.**

Cross-platform, real-time screen sharing. Share your screen from a computer,
watch it in any browser — desktop, Android, or iOS — with nothing to install
on the viewer's side.

> **Status: Phase 0 — foundation.** Not yet usable. See
> [`docs/roadmap.md`](docs/roadmap.md) for what ships when.

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

| | Share | View |
|---|---|---|
| Windows / macOS / Linux desktop app | ✅ | ✅ |
| Desktop browser (Chrome, Edge, Firefox, Safari 17+) | ✅ | ✅ |
| Android | app — *planned* | ✅ browser |
| iOS / iPadOS | *deferred* | ✅ browser |

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

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Full technical architecture v1.0 |
| [`docs/platform-matrix.md`](docs/platform-matrix.md) | Per-OS capture capabilities and limits |
| [`docs/roadmap.md`](docs/roadmap.md) | Phases and scope |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records |

## Development

Requires Node.js 22 LTS and pnpm 9+.

```bash
pnpm install
pnpm dev
```

## License

Not yet chosen.
