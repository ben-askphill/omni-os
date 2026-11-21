Thread list row (the agent's 32px avatar, title + chips + time, the status dot at the far end, preview line) and ThreadGroup.

```jsx
<ThreadGroup label="Today" count={3}><ThreadRow title="Patch shipping-rate script" state="running" role="builder" harness="claude-code" time="12m" /></ThreadGroup>
```

`avatar` is the agent's AgentAvatar, its eyes on the row's state (ADR 0021, D23); a thread with no agent leaves it out and the channel's Monogram leads (`channel`, else `home`). A group thread whose agents work or wait on you passes their faces. `channel` adds #name on line two for cross-channel lists; compact hides line two. The dot at the far end is StatusDot: `state` takes the plain words, `mark` any of the 18 states (Waiting on crew, Ready for review and the rest). markedDone is Ben's Mark as done (out of Needs you): grey check for the dot, muted title, outline Done chip.
