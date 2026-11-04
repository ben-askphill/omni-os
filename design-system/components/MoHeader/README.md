Headers for the phone: a 52pt bar for pushed screens and a 30pt large title for tab roots.

Pushed screens (a thread, an artifact, a PR) get `MoHeader` with `onBack`, a one-line title, a subtitle (`#channel · role · harness`) and at most two trailing actions. Tab roots (Activity, Channels, Library, PRs) get `MoLargeTitle`. Its subtitle counts what matters right now: `running` in live text, `needs` in medium ink. This is where the screen gets its first touch of colour.

```jsx
<MoHeader onBack={goBack} title={thread.title} sub="#Volero · builder · Claude Code" right={<MoRoundButton icon="more" label="More" />} />
<MoLargeTitle title="Activity" sub="Friday 23 October" running={4} needs={3} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
