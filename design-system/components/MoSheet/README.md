The phone bottom sheet: 28pt top corners, a grabber and an optional title row, for secondary choices.

Use it for the thread menu, attach with model and effort, search and new delegation. The scrim is ink 22% (50% in dark) with no blur; tapping it closes. Inside, compose `MoGroup` and `MoListRow`. On Expo it renders in a `Modal`; for drag-to-dismiss and detents, put the same content in a native `formSheet` screen.

```jsx
<MoSheet visible={open} title={thread.title} onClose={close}>
  <MoGroup><MoListRow icon="pin" label="Pin" onPress={pin} chevron={false} last /></MoGroup>
</MoSheet>
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
