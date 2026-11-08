# iOS icon audit, 8 November 2026

## Delivery

PR #573 merged to main at 2026-11-07 21:05:44 UTC, commit `622a5d2a`.
EAS published production update group `4ae293ad-594d-4fa4-bc3a-f2abae5bbfd3`
at 2026-11-07 21:09:03 UTC for iOS runtime `5299007d7b9ad83307c12d1314499e5c04376659`.
The later #574 production update, group `38c82359-78d7-44ff-868b-c5359d42e412`,
includes #573 as well. Production points to the production branch.

Build 7 uses that runtime. Builds 5 and 6 use
`60f7691fb9ce887f80d3de1feeebb97ad10c6ef8` and cannot receive these icons.
The physical phone's installed build and downloaded update were not observable.
An old build or a pending update can explain missing global icons. Missing
thread-detail icons also had coverage gaps, listed below.

In TestFlight, install build 7 or a later production build. Launch Omni with
network access, leave it open long enough to download, quit it fully and reopen.
A second quit and reopen may be needed. Settings > About now shows the native
build, channel, full runtime and running update ID. An embedded launch means
it is still running the JavaScript bundled with the binary.

This follow-up uses JavaScript only and keeps the existing native modules.
Merge its PR to main to invoke `.eas/workflows/ios-release.yml`. Confirm the
Publish an update job succeeds before expecting the fixes on a phone. Do not
publish a development checkout to production. If the merge workflow fails,
use a clean checkout of the merged main commit and run from `apps/ios`:

```sh
APP_VARIANT=production npx eas-cli@latest update --channel production --platform ios --environment production --message "Complete iOS icon coverage"
```

## Coverage gaps fixed in this follow-up

Paths below are relative to `apps/ios/src/`. The web drawing names are shared
by `Icon`; vendor, crew and link marks use `ui/Brand.tsx`.

| Location | Previously | Shared drawing now |
| --- | --- | --- |
| `ui/SlideToConfirm.tsx` | Text arrow | `arrowRight` |
| `components/thread/HandoffBanner.tsx` | Warning and clock Unicode characters | `alert`, `clock` |
| `components/thread/QuestionCard.tsx` | Text check in selected multi-choice option | `check`; radio selection remains a geometric dot |
| `components/continue/CarryoverSections.tsx` | Text triangles on exact-text disclosure | `chevronDown`, `chevronRight` |
| `components/thread/rows/Steps.tsx` | Tool categories absent, only status dots | `terminal`, `file`, `globe`, `layers`, `tool`, plus disclosure chevrons; status remains separate |
| `components/thread/rows/Cards.tsx`, cloud card | Vendor mark absent, links and branch text only | `HarnessLogo` for Cursor Cloud, `branch`, `pr`, `external` |
| `components/thread/rows/Cards.tsx`, delegated children | Crew role text only | `CrewMark` when the role has a shared mark |
| `components/thread/rows/Cards.tsx`, artifact card | File extension as icon | `image` for image/screenshot, `globe` for HTML/SVG, otherwise `file`, matching web `kindIcon` |
| `components/thread/rows/Cards.tsx`, plan | Completed item used a status dot | `check` for completed items |
| `components/thread/rows/Cards.tsx`, prompt caption | Interrupted/queued/dropped caption text only | `stop`, `send`, `x` where those captions apply |
| `screens/LibraryScreen.tsx` | Extension-only fallback for files without thumbnails | Same artifact-kind drawings, with extension retained as metadata |
| `attachments/AttachmentRow.tsx`, image viewer | Share and Done text controls | `share`, `x`; accessibility labels retained |

## Already covered by #573

- `ui/Icon.tsx` renders every shared line drawing and Grok with native SVG paths.
  `ui/symbols.ts` contains aliases to shared names, not an SF Symbol mapping.
  `expo-symbols` stays installed solely to preserve build 7's native fingerprint.
- `navigation/native-tabs.tsx` and `navigation/tab-icons.ts` use generated template
  PNGs for Activity, Channels, Library and New. They are generated from shared
  `inbox`, `hash`, `layers`, `plus` paths. `packages/shared/tests/tab-icons.test.ts`
  checks the source hash and PNG dimensions.
- Headers use `components/HeaderButton.tsx`; custom header titles use
  `ChannelAvatar`. `components/thread/ThreadMenuSheet.tsx` and its nested machine
  and folder sheets use `Icon` through `OptionRow`.
- `components/ThreadSwipeRow.tsx` and `components/activity/InboxRows.tsx` use
  `Icon` for swipe and done/undo actions. Thread rows, Channels, Activity and
  search results use `ChannelAvatar` and geometric `StatusDot` drawings.
- `ui/EmptyState.tsx`, `ui/GroupedList.tsx`, `ui/OptionRow.tsx`, settings parts
  and section rows use shared drawings. Agent settings and run pickers use
  `HarnessLogo` and `CrewMark`. Composer and attachment controls use `Icon`.
- `screens/PullRequestScreen.tsx` already uses GitHub `LinkBrand`.
  Emoji selected as a channel's actual identity and letter-avatar fallbacks
  are also web behavior; they are not substitute application icons.

## Documented exceptions

| Location | Web equivalent | Reason |
| --- | --- | --- |
| `navigation/detail-screens.tsx` | `chevronLeft` | UIKit owns native-stack back buttons and the interactive back gesture. Keep the platform back indicator. App-owned back buttons already use shared paths. |
| `screens/ArtifactScreen.tsx`, `attachments/AttachmentRow.tsx` after opening Share | `share` | The triggering controls use shared icons. Activity destinations and actions inside `Share.share` belong to UIKit and installed apps. |
| `screens/ChannelsScreen.tsx`, channel long-press sheet | `sliders`, `plus` | React Native's `ActionSheetIOS` accepts text options, not per-option images. It shows labels, not SF substitutes. |
| `components/thread/ThreadMenuSheet.tsx` rename prompt; confirmation dialogs in screens | Edit/check/trash actions | `Alert.prompt` and `Alert.alert` buttons are UIKit text actions with no icon slot. The menus that open them use shared icons. |
| `components/thread/Markdown.tsx` | `LinkMark`, all shared link-brand drawings | `EnrichedMarkdownText` renders native attributed text. Its current JS API provides link styles and press callbacks, not custom inline React children or attributed-image attachments. Generated PNGs cannot be placed into a link via that API either. Inline brand marks require extending the native renderer or replacing the markdown renderer, beyond a JavaScript-only icon fix. Standalone link marks use `LinkBrand` now. |
| `components/ChannelAvatar.tsx`, `screens/ActivityScreen.tsx` | Animated `OmniMark` | The static Omni ring and satellite are present. Web liquid motion is not implemented in the native drawing. This is animation parity, not an SF fallback. |
| Native progress controls across screens and `components/StatusDot.tsx` | `Loader` | ActivityIndicator and RefreshControl are native progress indicators; running status uses the app's animated geometric dot. They do not substitute SF Symbols for application icons. Web's liquid loader motion is not implemented. |
| `components/artifact/ArtifactBody.tsx` Quick Look; `screens/connect/ScanPanel.tsx` and attachment pickers | Platform viewers/pickers | OS-owned file previews, camera and library controls use the system's drawings. |

No application source imports `expo-symbols` or configures an SF Symbol image.
The iOS icon tests exercise the actual SVG components for every registered name,
alias and brand, and reject new SF imports and the removed Unicode stand-ins.
Web desktop, phone web and Electron require no code changes for this iOS-only
coverage fix. They already render these drawings.
