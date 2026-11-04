# Phone

The phone is where Ben checks on his agents. It answers three questions in order: what needs me, what is running, and what finished. Every phone screen is built from the components in this chapter, which exist twice with the same names and props: as React for the web phone layout and these previews (`components/mobile/*.jsx`), and as Expo / React Native for the iOS app (`components/mobile/native/*.tsx`).

## Principles

- **Status before input.** Home is Activity, not a composer. Needs you comes first and is answerable in place.
- **One surface at a time.** Desktop panels become full-screen pushes from the thread menu. No split views, no drawers.
- **Outcome first.** A finished thread opens on its summary and artifact. Tool calls fold into one steps row.
- **Actions in the thumb zone.** Tab bar, new delegation, action chips and the answer buttons sit in the bottom third.
- **Colour is the signal.** The phone uses the same three pops as the desktop, and they carry the screen: a vermilion answer button, ultramarine progress and pings, volt done discs. Everything else is neutral, so the colour that is there means something. A phone screen with no colour on it should mean nothing is happening.
- **Depth from shadows, not borders.** The tab bar and sheets float on `shadow-menu`; white sheets inside surface cards get `shadow-card`. Cards themselves are flat surface fills.
- **Motion from the springs.** Presses scale to .96 with the settle; the tab thumb and toasts use the spring. The running ping is the only thing that moves on its own. Reduced motion turns all of it off.

## Metrics

Points on a 390 × 844 phone. The `phone` token family in `tokens.json` holds them; `native/theme.ts` exports the same values as `phone`.

| Part | Value | Note |
| --- | --- | --- |
| Status bar inset | 54 (safe area on device) | Top of every header |
| Header | 52 | 40pt round buttons, 12pt sides |
| Large title | 30 / 1.1, 500, −0.3 | Tab roots only |
| Side gutter | 16 | Lists and cards |
| Tab bar | 60, radius pill | 14pt in from the sides, above the home indicator |
| New delegation | 60 | Ink disc beside the tab bar |
| Round button | 40 (32 in sheets) | Hit area at least 44 |
| Action chip | 36 | Above the composer |
| Answer button | 48 | Vermilion pill in decision cards |
| List row | 52 minimum | Grouped lists |
| Thread avatar | 36 | Status glyph on its corner |
| Composer | 52, radius 26 | Chips above |
| Card radius | 20 (inner sheets 14) | Decision, group, artifact |
| Sheet radius | 28 | Grabber 36 × 5 |

## Type

SF Pro throughout, set by the system on iOS (no `fontFamily`). Weights are 400 and 500; 600 only for rare emphasis. Mono (Menlo on iOS, which stands in for SF Mono) is only for file names, branches and ids.

| Style | Size / line | Weight | Use |
| --- | --- | --- | --- |
| largeTitle | 30 / 33 | 500 | Tab root titles |
| sheetTitle | 17 / 21 | 500 | Sheet titles |
| cardTitle | 16 / 21 | 500 | Decision card question |
| navTitle | 15 / 19 | 500 | Pushed header title |
| row | 15 / 20 | 400 | Thread and list rows (500 when it needs you) |
| bubble, prose | 15 / 22, 15 / 24 | 400 | Your messages, agent prose |
| body | 14 / 21 | 400 | Card bodies |
| chip | 13.5 / 14 | 500 | Action chips, toasts |
| sub | 12.5 / 17 | 400 | Second lines |
| caption | 12 / 16 | 500 | Section captions |
| meta | 12 / 16 | 400 | Times and counts, tabular figures |
| tab | 11 / 11 | 500 | Tab labels |

## Components

| Component | What it is | Web | Expo |
| --- | --- | --- | --- |
| MoRoundButton, MoActionChip | 40pt round button, 36pt chip | `MoButtons.jsx` | `native/MoButtons.tsx` |
| MoHeader, MoLargeTitle | Pushed header, tab-root title | `MoHeader.jsx` | `native/MoHeader.tsx` |
| MoSection | Caption + count over a list | `MoSection.jsx` | `native/MoSection.tsx` |
| MoThreadRow, MoAvatar, MoDiff | The thread row | `MoThreadRow.jsx` | `native/MoThreadRow.tsx` |
| MoGroup, MoListRow, MoRadio | Grouped lists | `MoList.jsx` | `native/MoList.tsx` |
| MoDecisionCard, MoResolvedStrip | Needs-you card and its answered strip | `MoDecisionCard.jsx` | `native/MoDecisionCard.tsx` |
| MoTabBar | Floating tabs + new delegation | `MoTabBar.jsx` | `native/MoTabBar.tsx` |
| MoSheet | Bottom sheet | `MoSheet.jsx` | `native/MoSheet.tsx` |
| MoComposer | Pinned composer | `MoComposer.jsx` | `native/MoComposer.tsx` |
| MoBubble | Your message | `MoBubble.jsx` | `native/MoBubble.tsx` |
| MoArtifactCard | Artifact peek in a thread | `MoArtifactCard.jsx` | `native/MoArtifactCard.tsx` |
| MoToast | Confirmation pill | `MoToast.jsx` | `native/MoToast.tsx` |

The Expo set also carries what the web gets from the core components: `theme.ts` (every colour in light and dark, shadows, type, phone metrics, motion, `useOmniTheme()`), `Icon` with the full icon set (`icon-paths.ts`, generated from `components/icons/Icon.jsx`), `CrewMark`, `StatusGlyph` with the running ping, and `Press` (the .96 press spring).

## Using it in the iOS app

1. Copy `components/mobile/native/` into `apps/ios/src/ds/`.
2. Add react-native-svg: `npx expo install react-native-svg`. Reanimated and react-native-safe-area-context are already in the app.
3. Replace `apps/ios/src/theme.ts` with `ds/theme.ts`. The old file copied only part of the palette: no `elev`, `warn`, `wash`, `scrim` or status text, no shadows and no motion. Its `StatusDot` says outright that the theme had no success or danger colour; `StatusGlyph` replaces it.
4. Build screens from the components: Activity from `MoLargeTitle`, `MoSection`, `MoDecisionCard` and `MoThreadRow`, with `MoTabBar` as the tab bar.

The components were typechecked against React Native 0.88, Reanimated 4.7, react-native-safe-area-context 5.10 and react-native-svg 15.12 (the versions in `apps/ios`).

## Keeping the two in step

- A token change goes into `tokens.json` first, then `native/theme.ts`, `apps/web/src/index.css` and `apps/mac/Omni/Theme.swift`.
- A new icon goes into `components/icons/Icon.jsx`; regenerate `native/icon-paths.ts` from it.
- A change to a phone component changes both files and its `.d.ts`, which documents the shared props. Web-only props (`placement`) and Expo-only props (`visible`, `onLongPress`, `sendLabel`) say so in the `.d.ts`.

The earlier live kit (`Mobile Design System.html`, `ui_kits/omni-mobile/`) shows the full flows: delegation, PR merge, the lock screen. It predates these components and draws its own parts.
