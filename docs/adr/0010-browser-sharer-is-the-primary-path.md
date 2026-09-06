# ADR-0010 — The browser sharer is the primary path for v1

**Status:** Accepted · 2026-09-06

## Context

The architecture lists two ways to share a screen from a desktop, and treats
the desktop app as the product and the browser as a bonus:

> | Desktop browser (Chrome/Edge/Firefox/Safari 17+) | `getDisplayMedia` — **no install** | ✅ Phase 1 (bonus path) |

That ordering was chosen on capability. Ranked on capability the desktop app
does win: whole-screen capture without a picker dialog, room for system audio
in Phase 6, global shortcuts, an icon in the tray. The browser gives a narrower
version of the same thing.

But the product's stated purpose is not capability. It is the moment a friend
asks what you are doing and you want them to see, without either of you setting
anything up. Ranked on _how fast a person who has never heard of CrossScreen
ends up looking at a screen_, the two paths are not close — and the gap is not
mainly technical.

**Shipping a desktop app to strangers costs money before the first user
arrives, and the cheap route is closed to us.**

|                            | Browser sharer | Electron app                                         |
| -------------------------- | -------------- | ---------------------------------------------------- |
| To start sharing           | open a link    | download ~150 MB, install                            |
| Windows                    | nothing        | code signing certificate, or a SmartScreen warning   |
| macOS                      | nothing        | Developer ID + notarisation, or a Gatekeeper refusal |
| Cost before the first user | none           | ~$320/year                                           |

The details behind that last row, checked 2026-09-06:

- **Windows.** An OV code signing certificate is about $215–230/year, and since
  June 2023 the private key must live on a FIPS 140-2 Level 2 device — so a
  hardware token is shipped internationally and cleared through customs, or an
  existing compliant HSM is used. From 15 February 2026 certificates are issued
  for at most one year, so this recurs annually.
- **Azure Artifact Signing** (formerly Trusted Signing) would be $9.99/month
  and would avoid the token entirely. It became generally available in January
  2026 **for individuals in the USA and Canada, or organisations in the EU and
  UK.** An individual in India is not in that list, so the cheap path is
  probably unavailable to us. Worth re-checking before Phase 3a rather than
  assumed either way.
- **macOS.** Apple Developer Program at $99/year is required for a Developer ID
  certificate and for notarisation. Without it Gatekeeper refuses to open the
  app at all — not a warning, a refusal.

Unsigned distribution is not a free alternative. Windows SmartScreen tells the
user the app is unrecognised and may harm their computer; macOS says the
developer cannot be verified and declines to launch. For a screen-sharing tool
asking permission to record the screen, arriving with that warning attached is
worse than not arriving.

None of it applies to a browser tab.

## Decision

**The browser sharer is the primary path for the first public version.** The
Electron app remains in the plan, keeps ADR-0002 unchanged, and becomes the
better-experience upgrade rather than the way in.

Concretely:

1. Phase 1 ships the browser sharer as a first-class path, not a bonus. The
   create → join → approve → connect flow must be complete in a browser tab on
   Windows, macOS and Linux.
2. The Electron app continues to be built and tested — the walking skeleton is
   already Electron, and nothing there is discarded — but it is distributed
   when signing is in place, not before.
3. Code signing moves out of the critical path to launch. It stays in Phase 3a
   as the gate for _desktop app distribution_, which is no longer the gate for
   _having users_.

## Consequences

- **Positive: a public launch costs the price of a domain.** Everything else
  the first version needs has a free tier that MVP traffic fits inside — see
  [`../cost-model.md`](../cost-model.md).
- **Positive: the first version reaches Windows, macOS and Linux at once**,
  without waiting for Phase 3b to validate an installer on each. A browser tab
  has no per-OS packaging.
- **Positive: it removes the slowest external dependency from the launch.** A
  certificate involves identity validation, a shipped token and customs. None
  of that can be hurried, and none of it now blocks anything.
- **Negative: the browser sharer is a smaller product.** The user picks a
  screen or window through the browser's own dialog rather than ours; there is
  no tray icon and no global shortcut; system audio is unavailable or partial
  depending on browser and OS. These are real, and they are the reason the
  desktop app still exists.
- **Negative: Safari is the weak corner.** `getDisplayMedia` arrived in Safari
  17, and Safari's screen-share behaviour is the least consistent of the four.
  Chrome, Edge and Firefox on desktop are the support commitment for the
  browser sharer; Safari is best-effort and must be labelled that way, the same
  way Linux compositors are.
- **Negative: mobile is unaffected and must not be over-promised.** No mobile
  browser can share a screen, so this decision does nothing for the "share from
  my phone" case. That still needs the native Android app in Phase 4.
- **Neutral: no code is thrown away.** The sharer logic already lives in
  `packages/webrtc-core`, shared by both. What changes is which shell reaches
  users first.

## Revisit when

- Azure Artifact Signing becomes available to individuals in India, which would
  drop the Windows cost to about $120/year and remove the token.
- Measured demand for whole-screen capture or system audio shows the browser
  path is losing people the desktop app would keep.
