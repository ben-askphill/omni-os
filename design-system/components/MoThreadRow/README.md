One row wherever a thread is listed on the phone: the agent's avatar, title, time and its status glyph at the far end, then channel and progress (ADR 0021, D23).

Pass the agent's AgentAvatar as `avatar`, its eyes on the row's state; nothing sits on it. The glyph at the end of the title's line is the StatusDot: the blue disc with its halo for running, the vermilion diamond for needs you, the volt disc with a tick for done, and any of the other 18 marks. A needs-you title is medium; a finished title drops to fg-2. Running `progress` ("step 5/9", "140 of 212") reads in live text, so a list of running threads shows its motion at a glance. Put `diff` or `artifacts` on the right when the thread produced them. On Expo, wrap the row in a swipe row for Pin, Done and Archive, and use `onLongPress` for the thread menu.

```jsx
<MoThreadRow title="Patch shipping-rate script" state="running" role="builder" channel="Volero" progress="step 5/9" time="12m" onPress={open} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
