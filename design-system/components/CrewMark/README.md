**Retired** ([ADR 0021](../../../docs/adr/0021-crew-avatars.md), D9). The product no longer draws crew marks: every agent shows its `AgentAvatar` (its photo, its icon on its color, else its crew character), on delegation cards, ask cards, the automations list, thread details, pickers and the iOS crew report cards. Don't use `CrewMark` in a new design. The card stays until the Claude Design project is synced, and goes with it.

What it was: crew role mark, usually inside a 28px surface-2 circle.

```jsx
<CrewMark role="builder" size={15} />
```

conductor ring · researcher aperture · builder block · store-ops tag · inbox tray.
