# Architecture Decision Records

One file per decision that would be expensive to reverse. Never change a
decision by editing its ADR — supersede it with a new one and mark the old
`Superseded by ADR-XXXX`.

Format per [`architecture.md`](../architecture.md) §74: current decision,
problem, proposed change, reason, benefits, risks, migration impact.

| ADR                                                | Decision                                                     | Status   |
| -------------------------------------------------- | ------------------------------------------------------------ | -------- |
| [0001](0001-ios-viewer-only-in-v1.md)              | iOS is viewer-only in v1; sharing deferred to Phase 8        | Accepted |
| [0002](0002-electron-for-desktop.md)               | Electron for the desktop client                              | Accepted |
| [0003](0003-native-kotlin-for-android.md)          | Android sharer is native Kotlin                              | Accepted |
| [0004](0004-managed-turn-for-mvp.md)               | Cloudflare Realtime TURN for MVP, coturn later               | Accepted |
| [0005](0005-no-redis-in-mvp.md)                    | No Redis in MVP; `SessionStore` interface instead            | Accepted |
| [0006](0006-mandatory-host-approval.md)            | Host approval is mandatory                                   | Accepted |
| [0007](0007-no-accounts-in-mvp.md)                 | No accounts in MVP                                           | Accepted |
| [0008](0008-fastify-and-plain-websocket.md)        | Fastify + plain `ws`, not NestJS/Socket.IO                   | Accepted |
| [0009](0009-desktop-os-ship-together.md)           | All three desktop OSes ship from one codebase                | Accepted |
| [0010](0010-browser-sharer-is-the-primary-path.md) | The browser sharer is the primary path for v1                | Accepted |
| [0011](0011-stateless-session-tokens.md)           | Session tokens are self-contained; signaling owns live state | Accepted |
