Thread list row (32px lead, title + chips + time, preview line) and ThreadGroup.

```jsx
<ThreadGroup label="Today" count={3}><ThreadRow title="Patch shipping-rate script" state="running" role="builder" harness="claude-code" time="12m" /></ThreadGroup>
```

channel shows avatar + #name for cross-channel lists; compact hides line two. markedDone is Ben's Mark as done (out of Needs you): grey check for the dot, muted title, outline Done chip.
