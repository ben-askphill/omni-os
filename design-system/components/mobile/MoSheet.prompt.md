The phone bottom sheet: 28pt top corners, a grabber and an optional title row, for secondary choices.

```jsx
<MoSheet visible={open} title={thread.title} onClose={close}>
  <MoGroup><MoListRow icon="pin" label="Pin" onPress={pin} chevron={false} last /></MoGroup>
</MoSheet>
```

Web: `components/mobile/MoSheet.jsx`. Expo: `components/mobile/native/MoSheet.tsx`. Styles: `components/mobile/mobile.css`.
