Transcript turn: you = right bubble, agents = markdown with no bubble.

```jsx
<Message role="user" time="14:02">…</Message>
<Message><p>…</p></Message>
```

ResultLine for the end-of-turn rule.

SwitchLine for a run switch between turns (model, effort or harness), with the handover note under it:

```jsx
<SwitchLine>Switched to effort high</SwitchLine>
<SwitchLine note="Codex reads the thread so far with your next message.">Handing over from Claude Code (Opus 5.5) to Codex (GPT-6-Luna)</SwitchLine>
```
