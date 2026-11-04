A short ink pill that springs up above the tab bar to confirm what just happened.

A few words, past tense: "Paused WEEKEND15", "Copied link". Add `status` for the glyph when the toast reports a thread's state. Position it 112pt above the bottom so it clears the tab bar.

```jsx
<MoToast status="done">Paused WEEKEND15</MoToast>
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
