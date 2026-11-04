Model and effort pills for the composer: `ModelPicker` groups models under each harness (Auto first, sticky plan headers, one search), `EffortPicker` lists the picked model's effort levels.

```jsx
<ModelPicker harnesses={harnesses} value={{ harness: 'claude-code', model: 'sonnet' }} onChange={set} />
<EffortPicker harnesses={harnesses} choice={choice} value="" onChange={setEffort} />
```

In a thread: `offerAuto={false}` and `up`. A pick switches the run; the transcript then shows a `SwitchLine`. During a turn the pick waits for it: show the queued run with `queued` on both pills and a `<NextTurnChip now="Sonnet 5.5, high" onKeep={keep} />` ahead of them. Never lock the pills during a turn.
