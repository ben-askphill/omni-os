CrewRoleRow is one crew role in Settings > Crew, on desktop web, phone web and the desktop app (`CrewSection` in `apps/web/src/pages/SettingsCrew.tsx`, chips from `crewChips` in `packages/shared/crew-settings.ts`). It is composed of existing parts: `CrewAvatar` (the role's own look on `Avatar`, else its `CrewMark`, else its monogram), `Chip` and the settings card's row rhythm.

```jsx
<CrewAvatar role={role} size={30} />     // own look, built-in mark, or initials
<Chip tone="outline">Built-in</Chip>      // where it comes from
<Chip tone="default">Edited</Chip>
<Chip tone="default">Yours</Chip>
<Chip tone="outline">Hidden</Chip>        // per machine
<Chip tone="default">Built-in charter changed</Chip>
<Chip tone="needs">Can't run here</Chip>  // its run defaults name a harness or model this machine lacks
<Chip tone="needs">2 lessons wait</Chip>  // its threads proposed lessons for its memory
```

## The row

- 30px avatar, then the name (13px medium) with its chips, the description (12.5px, `fg-3`, two lines at most) and the run line (12px, `fg-3`): "Auto", or harness · model · effort, then the default channel, "routes only" for a delegate-only role, "no file edits" for a no-edits role and "reviews" for a review role.
- The whole row is one button that opens the editor. A hidden role dims its avatar and name.
- Source chips: **Built-in** (outlined, shipped with Omni), **Edited** (a built-in with your overlay), **Yours** (a file of your own). Then what needs a look: **Hidden**, **Built-in charter changed**, and in vermilion **Can't run here** (the role cannot start) and **N lessons wait** (its memory has proposals for you).

## The avatar

A role's `avatar` in its frontmatter is a shared icon (`icon:<name>`) or one emoji, on a hex background: the channel avatar model without the SVG upload, which would not read in a markdown file. The editor reuses the channel `IconPicker` (SVG off) and `AvatarColorPicker`. Unset, a built-in keeps its `CrewMark` and any other role shows its monogram.

## The editor

An agent opens as a page of its own (New agent as a roomy `Modal`, a bottom sheet on the phone): its name and the role's chips, then one settings `Card` per group: Identity (`AgentIdentity`), Instructions (Add to built-in or Replace, the charter, the built-in charter in a disclosure), Run defaults (`ModelPicker`, `EffortPicker`, default channel `Picker`), Permissions (`Toggle` rows: may be delegated to, reviews work) and Memory (the two `Segmented` choices, a `Chip` with the waiting count, and the role's lessons as `MemoryRow`s). Then Advanced, the one group folded shut (`Advanced`): the tool switches (no file edits, conductor tools, only routes work), Edit as Markdown, Duplicate and Compare with built-in, and the file path. Hide or Show, Reset to built-in and Delete (`InlineConfirm`s, Delete in danger) close the page. Save and Cancel sit in a bar stuck to the bottom of the scroll, with an Unsaved changes note. No file edits carries the per-harness note in its hint, says it is not read only, and is disabled with a `LockNote` while Only routes work is on. Compare is a line diff in the diff tokens (`--diff-add-*`, `--diff-del-*`) with the three ways out of a changed built-in.

## Locked fields and actions

A built-in Omni relies on (the Conductor, usage-scan, the reviewer) sends `locks` with why. The editor shows each reason in a `LockNote` (the 13px lock glyph and 12.5px `fg-3` text that `EnvNote` already used for a field set in .env): under a locked power, whose `Toggle` is disabled; in place of the Add to built-in or Replace control when the charter can only be added to; and under the action row for a refused Duplicate or Hide, which the row leaves out.

```jsx
<Toggle checked disabled label="Only routes work" />
<LockNote>The Conductor only routes work, so it never gets working tools.</LockNote>
```

Implementation: `apps/web/src/pages/SettingsCrew.tsx`, `apps/web/src/components/CrewAvatar.tsx`, `LockNote` in `apps/web/src/pages/settings-parts.tsx`.
