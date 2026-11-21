The sidebar: search pill, New thread, Conductor (live mark), channels by kind with nested running threads, usage card, theme switch.

```jsx
<Rail channels={channels} activeId="vo" conductor={{state:"delegating"}} usage={usage} theme="light" onTheme={set} />
```

Soft thumb slides to the active row. Channels show running (ping) and needs (diamond) counts only. A thread's row leads with its agent's 18px avatar (`avatar` on the thread, an AgentAvatar with its eyes on the row's state), else its channel's Monogram, and ends with its status dot (ADR 0021, D23).
