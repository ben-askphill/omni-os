The needs-you card: the agent's question with the buttons that answer it, the same card in Activity and in the thread.

Three kinds: `confirm` (the question and why), `draft` (the draft to approve on a white sheet) and `choice` (radio options, one `recommended`). The answer is a 48pt vermilion pill, the only filled vermilion on the screen, so it is where the eye lands. The second button is surface-2. Once answered, replace the card with `MoResolvedStrip` and offer Undo. In the thread, pass `inThread` to drop the avatar and meta.

```jsx
<MoDecisionCard kind="confirm" title="Pause WEEKEND15 until the patch ships?" channel="Volero" role="store-ops" via time="3m"
  body="It stacks with free shipping." confirmLabel="Pause WEEKEND15" denyLabel="Keep it running" onConfirm={pause} onDeny={keep} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
