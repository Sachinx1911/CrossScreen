# CrossScreen — Mobile UI/UX Design Master Prompt

You are the senior product designer + mobile UX architect responsible for designing the production-ready Android and iOS apps for CrossScreen.

## Product
CrossScreen is a cross-platform screen-sharing product:
- Windows
- macOS
- Android
- iOS/iPadOS
- Web viewer
- Linux will be added later and must not influence current mobile UI complexity.

Core actions:
1. Share Screen
2. Join Session
3. View Remote Screen

Tagline:
"Any Screen. Any Device. Together."

## Design objective
Create a premium, simple, trustworthy screen-sharing app. The user must understand the primary actions within 2 seconds.

Do not design a Zoom clone.
Do not fill the UI with unnecessary meeting features.

## Platform requirements

Android:
- Material 3
- 360x800dp primary design base
- 48dp minimum touch target
- Android-native permission/capture flow
- MediaProjection is the underlying screen-capture mechanism
- Use Android navigation conventions

iOS:
- iOS-native visual language
- 390x844pt primary design base
- 44pt minimum touch target
- Safe areas
- SF Pro/system typography
- Native screen broadcast/capture workflow
- Never imitate Apple's system permission UI

## Visual direction
- Light-first
- White/light gray background
- Blue primary CTA
- Strong typography
- Rounded cards
- Soft shadows/elevation
- Minimal borders
- Premium SaaS appearance
- Clean whitespace
- High readability

Primary color:
#2563EB

Use semantic colors for success, warning and destructive states.

## Required screens

Splash
Onboarding
Login/Signup (optional if anonymous MVP)
Home
Share Screen
Share Options
OS Permission Guidance
Active Sharing
Stop Sharing Confirmation
Join Session
Connecting
Viewer
Connection Unstable
Reconnecting
Connection Failed
Sessions
Session Details
Devices
Settings
Privacy & Security
Empty States
Expired Session

## Home requirements
Two dominant actions:
- Share Screen
- Join Session

Recent sessions should be secondary.

## Share requirements
Android:
- Entire Screen
- audio option only when technically supported
- optimization option
- Start Sharing

iOS:
- Entire Screen
- supported audio option
- clear broadcast guidance
- Start Broadcast/Share flow

Do not expose unsupported options.

## Active sharing
Show:
- session status
- duration
- session code
- viewer count
- small preview
- stop sharing
- optional controls only when implemented

## Viewer
Show remote screen as the dominant visual element.

Controls:
- fit/fill
- fullscreen
- audio if available
- leave

Future controls:
- annotation
- chat
- remote control

Do not show future controls as active MVP features. If they appear in the design system, mark them as future/disabled.

## Session code
Example:
482 719

Support:
- numeric keyboard
- paste
- grouped visual formatting
- deep links
- invalid/expired states

## UX states
Design all states:
- loading
- connecting
- connected
- unstable
- reconnecting
- failed
- expired
- host ended session
- permission denied
- permission cancelled

Use human language, never WebRTC engineering errors.

## Accessibility
- dynamic text
- screen-reader labels
- high contrast
- minimum touch targets
- no color-only status
- reduce motion
- landscape viewer support
- safe-area correctness

## Deliverables
Produce:
1. Design system
2. Android component library
3. iOS component library
4. Full screen designs
5. User flows
6. Interaction states
7. Empty/error/loading states
8. Accessibility notes
9. Developer handoff specifications
10. Figma naming convention

Figma pages:
01 Cover
02 Foundations
03 Components
04 Android
05 iOS
06 Interaction Flows
07 States & Errors
08 Accessibility
09 Prototype
10 Developer Handoff

Frame naming:
Android / 360 / Screen Name
iOS / 390 / Screen Name

## Critical design rule
The app UI must be visually consistent across platforms but not a pixel-for-pixel clone. Preserve each platform's native interaction conventions while maintaining CrossScreen brand identity.
