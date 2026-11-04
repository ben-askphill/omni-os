Grouped lists on the phone: an inset surface group of 52pt rows for settings, channels, checks and files.

```jsx
<MoGroup>
  <MoListRow icon="branch" label="Runs on" value="This Mac" onPress={openMachines} />
  <MoListRow icon="archive" label="Archive" onPress={archive} chevron={false} last />
</MoGroup>
```

Web: `components/mobile/MoList.jsx`. Expo: `components/mobile/native/MoList.tsx`. Styles: `components/mobile/mobile.css`.
