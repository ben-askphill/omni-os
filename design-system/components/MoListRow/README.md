Grouped lists on the phone: an inset surface group of 52pt rows for settings, channels, checks and files.

`MoGroup` is the surface card (radius 20); `MoListRow` goes inside it. Rows take an icon (a name, or a node such as a `StatusGlyph`), label, sub, a `value` or a control on the right (a `Toggle` on web, a `Switch` on Expo), and a chevron when they push. Mark the last row `last` so its hairline drops. Destructive rows (Archive) read like any other row: the pops mean status only, and vermilion text on surface fails contrast.

```jsx
<MoGroup>
  <MoListRow icon="branch" label="Runs on" value="This Mac" onPress={openMachines} />
  <MoListRow icon="archive" label="Archive" onPress={archive} chevron={false} last />
</MoGroup>
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
