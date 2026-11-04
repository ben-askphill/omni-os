The phone tab bar: a floating 60pt pill of labelled tabs with the ink new-delegation disc beside it.

Activity, Channels, Library and PRs by default. The surface-2 thumb springs between tabs (ease-spring, 420ms). A vermilion diamond rides the Activity icon while anything needs you. It floats 14pt in from the sides on elev with the menu shadow, and hides on pushed screens. On Expo, use it as the custom `tabBar` of a bottom-tab navigator; it reads the safe-area inset itself.

```jsx
<MoTabBar value={tab} onChange={setTab} needs={needs.length} onNew={openNew} />
```

On Expo, import the same name from `components/mobile/native` (copied into `apps/ios/src/ds/`).
