# UI Scope — mapping the design mockup to build phases

Source design: [`design/ui-mockup-v1.png`](design/ui-mockup-v1.png)

The mockup is a good, coherent product vision and the visual direction is
adopted as-is: light background, blue primary, rounded cards, soft shadows,
one obvious primary action per screen.

**However, the mockup depicts the finished product, not the MVP.** Several
screens in it show capabilities that the approved architecture defers, and a
few contradict decisions in [`architecture.md`](architecture.md) §12. This
document reconciles the two so that nobody builds a screen that cannot work
yet — and so the deferred screens are not forgotten.

---

## 1. Conflicts to resolve before building

| #       | In the mockup                                                                          | Conflict                                                                                                                                                                    | Resolution                                                                                                                                                                                                                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C1**  | iPhone **"Share Screen → Start Broadcast"** screen                                     | ADR-0001 defers iOS sharing to Phase 8                                                                                                                                      | **Cut from v1.** On iOS, the app shows Join only. If a user reaches a share entry point on iOS, show an honest "Sharing from iPhone is coming — you can watch any screen here today."                                                                                                                                                |
| **C2**  | Nav bar **"Sign In" / "Get Started" / "Pricing"**, and a signed-in **"Sachin"** avatar | ADR-0007: no accounts in MVP. The mockup contradicts _itself_ — the hero also advertises "No Account Required"                                                              | **Cut Sign In, Get Started and Pricing from v1 nav.** Keep the "No Account Required" badge, which is the honest and stronger message. Nav in v1: Home · Features · How it Works.                                                                                                                                                     |
| **C3**  | **"Recent Sessions"** list with dates                                                  | Requires either accounts (cut) or persistence                                                                                                                               | **Keep, backed by `localStorage` only.** Per-device, never synced, cleared with browser data. Must not imply an account exists.                                                                                                                                                                                                      |
| **C4**  | **"Share system audio"** toggle, shown **ON**                                          | System audio is Phase 6, and is unavailable or partial on macOS/Linux/Firefox                                                                                               | **Show the toggle, default OFF, and disable it with a tooltip** where `capabilities().systemAudio === false`. Never render it as an available feature on a platform that cannot deliver it. ✅ built                                                                                                                                 |
| **C5**  | **"Optimize for smooth video"** toggle, shown **ON**                                   | This is the `contentHint` / `degradationPreference` control. Defaulting to _smooth_ directly contradicts architecture §9, which prioritises text legibility over frame rate | **Invert the default.** Ship as **"Optimise for text clarity" — ON by default** (`contentHint:'text'`, `degradationPreference:'maintain-resolution'`). Turning it off switches to `'motion'` / `maintain-framerate` for video playback. The product's core use case is teaching from a spreadsheet; blurry text is a failed session. |
| **C6**  | Viewer sidebar: **Chat, Draw, Pointer, Screenshot**                                    | Teaching Mode is Phase 7                                                                                                                                                    | **Cut from v1 sidebar.** Keep Participants, Quality, Fullscreen, Leave. Reserve the sidebar layout so the icons can slot in later without a redesign.                                                                                                                                                                                |
| **C7**  | Viewer bottom bar: **Mute, Stop Video**                                                | Implies microphone and camera. Neither is in MVP; the product is screen sharing, not a call                                                                                 | **Cut from v1.** Revisit with voice in Phase 7.                                                                                                                                                                                                                                                                                      |
| **C8**  | **Missing entirely: the host approval prompt**                                         | ADR-0006 makes host approval **mandatory** — it is what makes the 6-digit code safe                                                                                         | **Must be designed and added.** See §3 below. This is a blocking gap, not a nice-to-have.                                                                                                                                                                                                                                            |
| **C9**  | **Missing: the persistent "you are sharing" indicator** and first-share safety warning | Required abuse mitigation (architecture §7)                                                                                                                                 | **Must be added.** See §3.                                                                                                                                                                                                                                                                                                           |
| **C10** | Footer badge **"End-to-End Encrypted"**                                                | Accurate today (DTLS-SRTP, 1:1, TURN relays ciphertext it cannot read). Becomes **false** the moment an SFU lands in Phase 9 unless SFrame ships with it                    | **Keep the badge in v1** — it is true. Add a note to the Phase 9 ADR that this claim must be re-earned or removed.                                                                                                                                                                                                                   |

## 2. Screens in v1 scope

| Screen                                                         | Where          | Phase                                |
| -------------------------------------------------------------- | -------------- | ------------------------------------ |
| Landing / hero                                                 | `apps/web`     | 1                                    |
| Join a Session (code + paste link)                             | `apps/web`     | 1                                    |
| Viewer (video, connection state, quality, fullscreen, leave)   | `apps/web`     | 1                                    |
| Desktop: Share (source picker + preview + start)               | `apps/desktop` | 1                                    |
| Desktop: active-sharing state (code, link, viewer count, stop) | `apps/desktop` | 1                                    |
| Desktop: Join                                                  | `apps/desktop` | 1 — ✅ built                         |
| **Host approval prompt**                                       | `apps/desktop` | 1 — **new, not in mockup**, ✅ built |
| **First-share safety notice**                                  | `apps/desktop` | 1 — **new, not in mockup**, ✅ built |
| Sessions (recent, localStorage)                                | both           | 1 — ✅ built                         |
| Settings                                                       | both           | 1 (minimal)                          |
| Android: Share / Join                                          | `apps/android` | 4                                    |
| Teaching Mode sidebar (draw, pointer, chat, screenshot)        | `apps/web`     | 7                                    |
| iPhone: Share / Start Broadcast                                | `apps/ios`     | 8                                    |

## 3. Screens the mockup is missing

### 3.1 Host approval prompt — **blocking for v1**

Without this the 6-digit code is the only thing standing between a stranger
and someone's desktop. One million codes is not enough entropy to be the sole
gate. Approval is what makes the friendly short code safe.

```
┌────────────────────────────────────┐
│  Someone wants to view your screen │
│                                    │
│  📱  Android · Chrome              │
│      Joined with code 482 719      │
│      From Mumbai, India            │
│                                    │
│  They will see everything on       │
│  Screen 1 until you stop sharing.  │
│                                    │
│     [ Allow ]      [ Reject ]      │
└────────────────────────────────────┘
```

Rules: no SDP is exchanged before Allow is pressed; the prompt must show
device, browser and approximate location so the host can tell whether it is
the person they sent the link to; Reject is the default on timeout.

### 3.2 Persistent sharing indicator + first-share notice

Public screen-sharing services are a primary vector for tech-support scams.
Required in v1:

- A non-dismissible banner in the sharer app for the entire session.
- Viewer count always visible.
- One-click **Stop Sharing**, reachable from anywhere.
- Before a user's **first ever** share: a one-time notice — _"Only share with
  people you know. CrossScreen will never ask you to share your screen with
  support staff."_
- A **Report** affordance and server-side abuse logging.

## 4. Design system to extract from the mockup

To be encoded in `packages/ui` as Tailwind tokens during Phase 1:

- **Primary blue** for all CTAs, one per screen.
- Card surfaces: white, ~12 px radius, soft diffuse shadow, on an off-white page.
- Session code: large, tabular figures, grouped `482 719`, with a copy button.
- Connection status: a coloured dot plus words — never a bare colour, for
  accessibility (`● Connected · Good Connection`).
- Sidebar icon rail with labels beneath the icons.
- Mobile: large touch targets, bottom tab bar (Share · Join · Sessions · Settings).

Both light and dark palettes must be defined even though the mockup only
shows light — the viewer is frequently used at night.
