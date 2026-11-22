The sidebar: search pill, New thread, Conductor (live mark), channels by kind with nested running threads, usage card, theme switch.

```jsx
<Rail channels={channels} activeId="vo" conductor={{state:"delegating"}} usage={usage} theme="light" onTheme={set} />
```

Soft thumb slides to the active row. Channels show running (ping) and needs (diamond) counts only.

A thread's 32px row (`--h-nav`) leads with its agent's 18px avatar, 8px before the title, and ends with its status dot (ADR 0021, D23). Pass the avatar as `avatar` on the thread, an AgentAvatar with its eyes on the row's state; a thread with no agent leaves it out and its channel's Monogram leads. A group thread whose agents work or wait on you passes their faces.
