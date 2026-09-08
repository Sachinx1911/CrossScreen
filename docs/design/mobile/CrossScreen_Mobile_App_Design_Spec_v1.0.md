# CrossScreen Mobile App — Detailed UI/UX Design Specification v1.0

## 1. Product
CrossScreen — Any Screen. Any Device. Together.

Core purpose:
- Share a mobile screen to another device.
- Join a screen-sharing session from Android/iOS.
- View a remote screen.
- Keep the experience extremely simple and fast.
- The viewer should ideally not need to install the app.

Platforms:
- Android
- iOS/iPadOS

Design principles:
1. Screen sharing is the primary action.
2. Joining a session is the second primary action.
3. Never overload the user with WebRTC/network terminology.
4. Native platform conventions must be respected.
5. Android uses Material 3 patterns.
6. iOS uses iOS-native navigation, sheets, controls and permission flows.
7. The two apps should feel like the same product, not identical pixel copies.
8. Mobile-first, touch-first UI.
9. Accessibility and large-text support from day one.
10. All destructive actions require clear confirmation where appropriate.

## 2. Recommended device design bases

Android:
- Primary design frame: 360 × 800 dp
- Secondary validation: 412 × 915 dp
- Minimum touch target: 48 × 48 dp
- 4 dp spacing grid

iOS:
- Primary design frame: 390 × 844 pt
- Secondary validation: 430 × 932 pt
- Minimum touch target: 44 × 44 pt
- 4 pt spacing rhythm

Do not simply scale Android layouts onto iOS.

## 3. Information architecture

Bottom navigation:
- Home
- Sessions
- Devices
- Settings

Primary Home actions:
- Share Screen
- Join Session

Secondary:
- Recent Sessions
- Connected/registered devices
- Help & Support

## 4. Screen inventory

### A. Splash
Purpose:
- Brand recognition while app initializes.

Elements:
- CrossScreen logo
- CrossScreen wordmark
- Tagline: Any Screen. Any Device. Together.
- Minimal background decoration
- No unnecessary loading controls

Behavior:
- Auto-transition to onboarding/login/home.

### B. Onboarding
3 slides:
1. Share
   - Share your screen with anyone.
2. Connect
   - Join using a short session code or link.
3. Secure
   - Private sessions with encrypted WebRTC media.

Controls:
- Skip
- Next
- Get Started

### C. Authentication
Optional for MVP if anonymous sessions are preferred.

Sign in:
- Email
- Password
- Forgot password
- Continue with Google
- Continue with Apple
- Sign up

Architecture note:
- Authentication must never block a basic join flow unless product policy requires accounts.

### D. Home
Header:
- Greeting
- Profile avatar
- Connection status if relevant

Primary cards:
1. Share Screen
   - "Share your device screen"
2. Join Session
   - "Enter a code or open a link"

Recent sessions:
- Session code
- Date/time
- Role: Host/Viewer
- Status

Bottom navigation:
Home / Sessions / Devices / Settings

### E. Share Screen — Setup
Title: Share Your Screen

Options:
- Entire Screen
- Specific App (Android where supported / OS-dependent)
- Browser Tab is a web-specific capability and should not be shown as a generic native-mobile option unless technically available.

Controls:
- Share Audio — only when supported
- Optimize for Smooth Video
- Enable Annotation — future/optional

Primary CTA:
- Start Sharing

Before starting:
- Explain OS permission when needed.
- Do not fake the OS permission UI.

### F. Android Screen Capture Permission
This must use the actual Android MediaProjection permission dialog.

App should show a short pre-permission explanation only if necessary:
"CrossScreen needs permission to share your screen with the selected session."

Then invoke native OS permission.

### G. iOS Screen Broadcast
Use Apple's supported screen broadcast/capture flow.
The app should guide the user to the system Broadcast/Screen Recording control.
Do not recreate Apple's system permission dialog as a custom UI.

### H. Active Sharing — Host
Header:
- "You are sharing your screen"
- Connection indicator
- Session duration

Main:
- Live preview (small)
- Session code
- Viewer count

Actions:
- Pause (if supported)
- Mute audio (if audio enabled)
- Annotate (future)
- More

Primary destructive CTA:
- Stop Sharing

Stop confirmation:
"Stop sharing your screen?"
[Cancel] [Stop Sharing]

### I. Join Session
Title: Join a Session

Input:
- 6-digit/short session code
- Paste Link

CTA:
- Join Session

Recent sessions below.

Validation:
- Invalid code
- Expired session
- Session not found
- Host ended session
- Too many viewers
Use human-readable messages.

### J. Viewer
Header:
- "Viewing [Host name/device]"
- Connected indicator
- Session timer

Main:
- Remote screen in maximum useful area
- Preserve aspect ratio
- Support rotation/fullscreen where technically appropriate

Controls:
- Mute/unmute if audio is available
- Fit / Fill
- Fullscreen
- Chat (future)
- Annotation (future)
- Leave

### K. Connection States
Must have designed states for:
- Connecting
- Checking connection
- Establishing secure connection
- Connected
- Connection unstable
- Reconnecting
- Connection failed
- Session expired
- Host ended session

Never expose:
- ICE failed
- SDP error
- DTLS error
- TURN allocation failed

### L. Sessions
Sections:
- Active
- Recent
- Search/filter

Each row:
- Session code
- Host/device
- Role
- Date/time
- Duration
- Status

### M. Devices
Purpose:
- Show devices associated with the account.

Fields:
- Device name
- Platform
- Last active
- Current status

Actions:
- Rename
- Remove
- View details

### N. Settings
Sections:
- Account
- General
- Video & Audio
- Notifications
- Privacy & Security
- About

Avoid unnecessary settings in MVP.

## 5. Visual design

Brand direction:
- Modern SaaS
- Premium but approachable
- Light-first
- Strong blue primary action
- White surfaces
- Very subtle borders
- Soft elevation
- Large readable headings
- Rounded cards

Recommended semantic colors:
- Primary: #2563EB
- Primary dark: #1D4ED8
- Success: #10B981
- Danger: #EF4444
- Warning: #F59E0B
- Text: #0F172A
- Secondary text: #64748B
- Border: #E2E8F0
- Surface: #FFFFFF
- Background: #F8FAFC

Dark theme:
- Background: #0B1220
- Surface: #111827
- Text: #F8FAFC
- Secondary text: #94A3B8
- Border: #243244

## 6. Typography

Use platform-native/system fonts:
Android:
- Roboto / system sans

iOS:
- SF Pro / system font

Type scale:
- Display: 32/38, Bold
- H1: 28/34, Bold
- H2: 22/28, Semibold
- Title: 18/24, Semibold
- Body: 16/24, Regular
- Label: 14/20, Medium
- Caption: 12/16, Regular

Do not use too many font sizes.

## 7. Components

Required reusable components:
- PrimaryButton
- SecondaryButton
- IconButton
- TextField
- SessionCodeInput
- DeviceCard
- SessionCard
- StatusIndicator
- ConnectionBanner
- PermissionExplanationCard
- BottomNavigation
- TopAppBar
- SectionHeader
- EmptyState
- ErrorState
- LoadingState
- BottomSheet
- ConfirmationDialog
- ToggleRow
- SettingRow

States for every interactive component:
- Default
- Pressed
- Focused
- Disabled
- Loading
- Error
- Success where applicable

## 8. Session code UX

Display:
482 719

Input should automatically group digits visually.

Rules:
- Numeric keyboard
- Ignore accidental spaces
- Validate length
- Paste support
- Deep-link support
- Never use sequential/predictable internal IDs as public codes

## 9. Permission UX

Android:
- Explain briefly → trigger MediaProjection → return to app → start WebRTC.

iOS:
- Explain briefly → invoke supported broadcast/capture workflow → return to active session state.

Important:
- Never claim "screen recording" is active before the OS confirms the capture/broadcast is actually running.

## 10. Accessibility

Required:
- Dynamic text sizing
- Screen reader labels
- Minimum touch target
- Sufficient contrast
- No color-only status
- Visible focus state where relevant
- Reduce motion support
- Landscape handling for viewer
- Safe-area handling on iOS
- Edge-to-edge handling on Android

## 11. Responsive behavior

Android:
- 360 dp base
- 412 dp validation
- Tablets can use two-pane layouts later.

iOS:
- 390 pt base
- 430 pt validation
- iPad uses adaptive navigation/split view later.

## 12. Error UX

Examples:
- "We couldn't start screen sharing. Please allow screen sharing and try again."
- "This session code is invalid."
- "This session has expired."
- "The host ended the session."
- "Your connection is unstable. Reconnecting…"

Do not blame the user or expose engineering details.

## 13. Animation

Keep animation restrained:
- 150–250 ms transitions
- Subtle card/button feedback
- Connection status transitions
- No excessive decorative motion
- Respect Reduce Motion

## 14. MVP vs future

MVP:
- Splash
- Onboarding
- Home
- Share Screen
- OS permission flow
- Active Sharing
- Join Session
- Viewer
- Sessions
- Basic Settings
- Connection/error states

Phase 2:
- Audio
- Annotation
- Chat
- Better device management
- Recording

Phase 3:
- Multi-viewer
- SFU
- Remote control
- Advanced collaboration

## 15. Figma page structure

Create these Figma pages:
01 — Cover
02 — Foundations
03 — Components
04 — Android
05 — iOS
06 — Interaction Flows
07 — States & Errors
08 — Accessibility
09 — Prototype
10 — Developer Handoff

Android frame naming:
Android / 360 / Screen Name

iOS frame naming:
iOS / 390 / Screen Name

## 16. Main user flows

Flow 1 — Share:
Home → Share Screen → Select sharing mode → Permission → Active Sharing → Stop

Flow 2 — Join:
Home → Join Session → Enter code/link → Connecting → Viewer

Flow 3 — Reconnect:
Active Session → Connection Unstable → Reconnecting → Connected

Flow 4 — Session expiry:
Join → Invalid/Expired → Error State → Back Home

## 17. Design quality bar

The final design must:
- Look like a real production SaaS/mobile product.
- Avoid generic template styling.
- Keep Share and Join immediately obvious.
- Maintain consistent spacing and hierarchy.
- Use platform-native patterns where required.
- Clearly separate app UI from OS permission UI.
- Be implementation-ready for developers.
