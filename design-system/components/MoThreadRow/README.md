One row wherever a thread is listed on the phone: crew avatar with its status glyph, title, time, channel and progress.

The avatar's corner carries the status: ultramarine ping for running, vermilion diamond for needs you, volt disc for done. A needs-you title is medium; a finished title drops to fg-2. Running `progress` ("step 5/9", "140 of 212") reads in live text, so a list of running threads shows its motion at a glance. Put `diff` or `artifacts` on the right when the thread produced them. On Expo, wrap the row in a swipe row for Pin, Done and Archive, and use `onLongPress` for the thread menu.

```jsx
<MoThreadRow title="Patch shipping-rate script" state="running" role="builder" channel="Volero" progress="step 5/9" time="12m" onPress={open} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
