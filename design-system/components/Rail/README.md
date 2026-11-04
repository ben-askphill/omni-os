The sidebar: search pill, New thread, Conductor (live mark), channels by kind with nested running threads, usage card, theme switch.

```jsx
<Rail channels={channels} activeId="vo" conductor={{state:"delegating"}} usage={usage} theme="light" onTheme={set} />
```

Soft thumb slides to the active row. Channels show running (ping) and needs (diamond) counts only.
