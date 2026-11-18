CrewRoleRow is one crew role in Settings > Crew, on desktop web, phone web and the desktop app (`CrewSection` in `apps/web/src/pages/SettingsCrew.tsx`, chips from `crewChips` in `packages/shared/crew-settings.ts`). It is composed of existing parts: `CrewAvatar` (the role's own look on `Avatar`, else its `CrewMark`, else its monogram), `Chip` and the settings card's row rhythm.

```jsx
<CrewAvatar role={role} size={30} />     // own look, built-in mark, or initials
<Chip tone="outline">Built-in</Chip>      // where it comes from
<Chip tone="default">Edited</Chip>
<Chip tone="default">Yours</Chip>
<Chip tone="outline">Hidden</Chip>        // per machine
<Chip tone="default">Built-in charter changed</Chip>
<Chip tone="needs">Can't run here</Chip>  // its run defaults name a harness or model this machine lacks
```

## The row

- 30px avatar, then the name (13px medium) with its chips, the description (12.5px, `fg-3`, two lines at most) and the run line (12px, `fg-3`): "Auto", or harness · model · effort, then the default channel and "routes only" for a delegate-only role.
- The whole row is one button that opens the editor. A hidden role dims its avatar and name.
- Source chips: **Built-in** (outlined, shipped with Omni), **Edited** (a built-in with your overlay), **Yours** (a file of your own). Then what needs a look: **Hidden**, **Built-in charter changed** and, the only one in vermilion because the role cannot start, **Can't run here**.

## The avatar

A role's `avatar` in its frontmatter is a shared icon (`icon:<name>`) or one emoji, on a hex background: the channel avatar model without the SVG upload, which would not read in a markdown file. The editor reuses the channel `IconPicker` (SVG off) and `AvatarColorPicker`. Unset, a built-in keeps its `CrewMark` and any other role shows its monogram.

## The editor

A roomy `Modal` (`sm:max-w-2xl`; a bottom sheet on the phone) with Form and Markdown tabs (`Segmented`), the role's chips and file path, and the actions as small ghost buttons that wrap: Duplicate, Compare with built-in, Hide or Show, Reset to built-in (`InlineConfirm`), Delete (`InlineConfirm`, danger). Form groups: Identity, Instructions (Add to built-in or Replace, with the built-in charter in a disclosure), Run (`ModelPicker` and `EffortPicker`), Where, Powers (`Toggle` rows). Compare is a line diff in the diff tokens (`--diff-add-*`, `--diff-del-*`) with the three ways out of a changed built-in.

Implementation: `apps/web/src/pages/SettingsCrew.tsx`, `apps/web/src/components/CrewAvatar.tsx`.
