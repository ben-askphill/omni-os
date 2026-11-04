The needs-you card: the agent's question with the buttons that answer it, the same card in Activity and in the thread.

```jsx
<MoDecisionCard kind="confirm" title="Pause WEEKEND15 until the patch ships?" channel="Volero" role="store-ops" via time="3m"
  body="It stacks with free shipping." confirmLabel="Pause WEEKEND15" denyLabel="Keep it running" onConfirm={pause} onDeny={keep} />
```

Web: `components/mobile/MoDecisionCard.jsx`. Expo: `components/mobile/native/MoDecisionCard.tsx`. Styles: `components/mobile/mobile.css`.
