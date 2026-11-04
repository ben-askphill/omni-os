The phone composer: action chips, then + for attach, model and effort, the field, and mic, send or stop.

Pin it above the keyboard. The placeholder names who you are talking to ("Steer the builder", "Follow up", "Ask the Conductor"). Mic shows until there is text, then the ink send button. While a turn runs and the box is empty, pass `onStop` and Stop replaces the mic. Attachment and context chips go in `children`. On Expo, set `sendLabel` to Steer or Queue when the message will not start a turn.

```jsx
<MoComposer placeholder="Steer the builder" onStop={stop} onSend={send} actions={[{ label: 'Changes so far', icon: 'diff', diff: [214, 38] }]} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
