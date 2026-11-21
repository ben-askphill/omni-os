MemoryRow is one memory fact: a channel's Recent learning (channel settings) or a crew role's lesson (Settings > Crew > a role > Memory), on desktop web, phone web and the desktop app (`apps/web/src/components/MemoryRow.tsx`, used by `ChannelLearnings` and `RoleMemory`). It is composed of existing parts: the `surface-2` rounded block, `Chip`, ghost and primary `Button`s and `InlineConfirm`.

```jsx
<MemoryRow fact={lesson} onChanged={reload} />                         // a channel's learning
<MemoryRow fact={lesson} onChanged={reload} scope="#acme only" />      // a role's lesson, tagged with a channel
<MemoryRow fact={lesson} onChanged={reload} scope="Every channel" />
```

## The row

- A `surface-2` block with 14px corners, 14px by 10px padding: the lesson in 13px `fg`, then a 12px `fg-3` meta line that wraps.
- Meta, left to right: the state, the scope chip (role lessons only), "From a thread" (a link to the thread that proposed it), and the actions pushed to the end.
- State: **Waiting for you** (`Chip` in vermilion, `needs`) for a proposal; "Approved 2h ago" once approved; "Kept at once 2h ago" for a lesson an agent kept on a role that applies its lessons at once (`memory_writes: auto`), which still names its thread.
- Scope: an outlined `Chip`, "Every channel" or "#acme only".
- Actions: a waiting lesson gets **Approve** (primary, small), **Edit** and **Dismiss** (`InlineConfirm`); an approved one gets **Edit** and **Delete**. Editing swaps the text for a textarea with Cancel and Save, or "Save and approve" on a waiting one.

## The Memory group's lessons

The lower half of the agent page's Memory card, under a hairline, with the waiting count as a `Chip` beside the card's title ("2 waiting"). A 12.5px `fg-3` note says how the role's memory works (reads and proposes, reads only, off, or applies at once), then the rows, waiting first, then an input with an "Applies in" `Picker` (Every channel, or one channel) and **Add lesson**. The role's row in the list gets a vermilion `Chip`, "2 lessons wait". The same card sets the role's `memory` and `memory_writes` with two radio `Segmented` controls.

Implementation: `apps/web/src/components/MemoryRow.tsx`, `apps/web/src/components/RoleMemory.tsx`, `apps/web/src/pages/SettingsCrew.tsx`, chips and scope from `packages/shared/crew-settings.ts`.
