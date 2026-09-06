# What CrossScreen costs to run

CrossScreen is free for the people who use it. That is a product decision, and
it makes the running cost a design constraint rather than an afterthought: with
no revenue, anything that scales with usage eventually has to be paid for out
of pocket, so it is worth knowing in advance where the line is.

This document answers three questions in order: **what is free and how far does
free go**, **what actually costs money and when**, and **what has to be true
today so that paying later is a bill rather than a rewrite**.

Figures checked 2026-09-06. Prices move; the shape of the argument does not.

---

## 1. The short version

|                                                       | Cost                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Everything up to a public launch, browser sharer only | **a domain, about ₹1,000/year**                          |
| Adding the signed desktop app                         | **+ ~$320/year** (Windows certificate + Apple Developer) |
| Running it once people use it                         | **free until roughly 4,000 session-hours a month**       |

The second row is the reason for [ADR-0010](adr/0010-browser-sharer-is-the-primary-path.md):
distribution costs money, the network does not.

---

## 2. What scales with usage, and where free ends

### TURN relay — the one that grows

Media is peer-to-peer whenever the network allows it, and peer-to-peer traffic
costs nothing at all: it never touches our infrastructure. Only relayed
sessions cost money.

Cloudflare Realtime TURN gives **1,000 GB per month free, then $0.05/GB**, and
two details make that go further than it first appears:

- **Only egress is billed** — data from Cloudflare to the client. Traffic from
  the client to Cloudflare is free.
- **STUN is unlimited and free**, and STUN is what most connections need.

Working it out at the 2 Mbps this product targets for screen content:

```
1 hour relayed   = 2 Mbit/s x 3600 s = 7200 Mbit = ~900 MB egress
1000 GB free     / 0.9 GB per hour   = ~1,100 hours of relayed session / month
```

Not every session relays. If a quarter of them do — a reasonable planning
figure until Phase 2 measures the real one — the free tier covers roughly
**4,400 hours of sessions a month**. That is about 145 hours a day, every day,
before the first rupee.

Past that it is $0.05/GB, or about **4.5 cents per relayed hour**. The cost
grows gently and only with sessions that could not go direct.

> **The number that predicts this bill is the relay ratio**, and Phase 2 exists
> partly to measure it. A ratio drifting upward means TURN cost arriving sooner
> — see [ADR-0004](adr/0004-managed-turn-for-mvp.md). It is already visible in
> the walking skeleton's stats line as `transport=direct` or `transport=relay`.

### Signaling and API — small, but always on

Signaling is a WebSocket that carries a few kilobytes per session and then goes
quiet; media never passes through it. The load is negligible. The requirement
is not capacity, it is **being awake**: free application tiers that sleep after
inactivity are a poor fit, because the cost of a cold start lands exactly when
someone is waiting to be shown something.

A small VPS is about **$5/month** and is what the architecture already assumes
(Mumbai, per §10). Free options exist and are worth trying first, with that
caveat understood rather than discovered.

### Database

Postgres holds session records, metrics and abuse logs — kilobytes per session,
and nothing in the media path. Managed free tiers are comfortably sufficient
for the MVP, and remain so well past it.

### Viewer hosting

The viewer is a static bundle. Free, permanently, on any of the usual static
hosts. This does not become a cost at any scale worth planning for.

---

## 3. What costs money, and when it starts

|                         | When                                         | Cost                            | Avoidable?                           |
| ----------------------- | -------------------------------------------- | ------------------------------- | ------------------------------------ |
| Domain                  | Phase 3a                                     | ~₹1,000/year                    | No, for a public launch              |
| Windows code signing    | Only to ship the desktop app                 | ~$215–230/year + hardware token | Yes — browser sharer needs none      |
| Apple Developer Program | Only to ship the macOS app, and for iOS ever | $99/year                        | Yes, until then                      |
| Google Play             | Phase 4, Android                             | $25 once                        | Sideloading avoids it; Play does not |
| VPS                     | Phase 3a                                     | ~$5/month                       | Not really                           |
| TURN over 1 TB          | When usage says so                           | $0.05/GB                        | No, and it should be welcome news    |

Two of these deserve more than a row.

### Windows code signing is more awkward than its price

Since June 2023 the private key must sit on a FIPS 140-2 Level 2 device, so a
certificate is not a file that arrives by email. Either a hardware token is
shipped internationally and cleared through customs, or an existing compliant
HSM is used — buying a FIPS-capable key locally avoids the shipping entirely
and is usually the faster route from India. From 15 February 2026 certificates
last at most a year, so this is annual, and lead time is measured in days
before it is measured in money.

**Azure Artifact Signing** (formerly Trusted Signing) would sidestep all of it
at $9.99/month with no token. As of its January 2026 general availability it
covers **individuals in the USA and Canada, and organisations in the EU and
UK** — which does not obviously include an individual in India. Check it again
before Phase 3a: eligibility changes are cheap to re-read and would cut this
cost by more than half.

### Not signing is not free either

An unsigned Windows build meets SmartScreen: _unrecognised app, might harm your
computer_. An unsigned macOS build meets Gatekeeper, which does not warn — it
refuses. For software whose first action is to ask permission to record the
screen, arriving with that attached costs more trust than the certificate costs
money. **Ship signed or ship in the browser; do not ship unsigned.**

---

## 4. Designing so that paying later is only a bill

The point of knowing the ceiling is to make crossing it uneventful. Four things
have to be true today, and three of them already are.

| Concern                          | Guarantee                                                                                                                                         | Where                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Swapping TURN provider           | Clients never hold a provider's credentials; they call `GET /api/v1/ice-servers` and receive short-lived ones. Switching is server configuration. | [ADR-0004](adr/0004-managed-turn-for-mvp.md), Phase 2 |
| Signaling outgrowing one machine | Live state sits behind a `SessionStore` interface. Redis becomes an implementation, not a rewrite.                                                | [ADR-0005](adr/0005-no-redis-in-mvp.md)               |
| Many viewers per session         | Mesh to 2–3 viewers, then an SFU. Deliberately deferred, with the trigger written down instead of guessed.                                        | Phases 5 and 9                                        |
| Adding accounts and billing      | Sessions are anonymous by design, not by accident, and nothing assumes an absent user table.                                                      | [ADR-0007](adr/0007-no-accounts-in-mvp.md)            |

The one that is not yet true: **the desktop build is not signed, and the
signing identity does not exist.** That is fine while the browser is the way
in, and it is the first thing to start — not finish, start — when the desktop
app is next in line, because certificate issuance and token delivery cannot be
compressed.

---

## 5. What would actually change the picture

Rather than a fixed budget, the honest triggers:

- **Relay ratio above ~40%.** TURN cost arrives much sooner than the estimate
  above. Investigate before paying: a high ratio usually means an ICE or
  candidate-gathering problem, not genuinely hostile networks.
- **Sustained usage past ~5M relayed minutes/month.** The published break-even
  where self-hosted coturn starts to win ([ADR-0004](adr/0004-managed-turn-for-mvp.md)).
  A long way away, and a good problem.
- **People asking for whole-screen capture or system audio.** The browser
  sharer's real limits, and the signal that the desktop app — and its
  certificate — has become worth buying.
- **Azure Artifact Signing opening to individuals in India.** Halves the
  Windows cost and removes the token. Worth re-checking, not worth waiting for.
