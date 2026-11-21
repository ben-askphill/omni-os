AgentSkills is the Skills group on an agent's page in Settings > Agents and in the New agent dialog, on desktop web, phone web and the desktop app (`AgentSkills` in `apps/web/src/components/AgentSkills.tsx`, its rules in `packages/shared/agent-skills.ts`). The skills ticked there load at the start of every thread the agent runs. It is composed of existing parts: `SearchField`, ui-sdk's `Checkbox` drawn as the question card's tick box, `StatusDot`, `ErrorNote` and `Loading`, inside the settings `Card`. A remote agent's page leaves it out.

```jsx
<AgentSkills
  value={['tdd', 'pr-writer']}     // the agent's `skills:`, in the order ticked
  onChange={(skills) => set('skills', skills)}
  channel="omni-os"                // its default channel: that repo's project skills join the list
  harness="claude-code"            // its default harness: one that runs off this machine gets a note
/>
```

## Layout

- **Note** on top only when the agent's default harness runs off this machine (Hermes, Cursor Cloud, a custom harness): skills load on Claude Code, Codex and Cursor Agent only.
- **Search** (`SearchField`, "Search skills") with the count beside it: "2 ticked of 400".
- **List**: a scroll box 22rem tall, rows divided by `--line`. A row is the tick box, the name in mono 12.5px, a 12px `fg-3` line of where it comes from ("Personal", "Plugin superpowers", "Project", "Built-in") and, when not every harness here lists it, which do ("Codex only"), then the description in two lines at most. The whole row toggles. The box is named by the skill alone, and described by its source and description.
- **Footer**: which harnesses the list came from, and that a project skill loads only in a repo that has it.

## Behaviour

- Ticked skills lead the list, in the order ticked; the rest follow by name. A search ranks the whole name, then a name that starts with it, then one that holds it, then a matching description.
- A ticked skill this machine no longer lists stays at the top with a `needs` dot and "Not on this machine", so it can be unticked.
- While a harness is still reading its first list, the list shows what it has and asks again.
- Nothing saves on its own: ticks go with the editor's Save, and the save bar says Unsaved changes.
