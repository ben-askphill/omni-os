The 40pt round button and the 36pt action chip that every phone screen is built from.

Use `MoRoundButton` for back, search, more, close (32pt in sheets), mic, send and stop. Only one ink button per screen: the primary action (send, stop). `quiet` drops the fill when the button sits on a surface, as the mic does in the composer.

Use `MoActionChip` for this thread's next step above the composer or in a card: Open report, Changes so far with a diff, Merge. `needs` fills it vermilion and is only for answering a question.

```jsx
<MoRoundButton icon="search" label="Search" onPress={openSearch} />
<MoActionChip label="Changes so far" icon="diff" diff={[214, 38]} onPress={openDiff} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
