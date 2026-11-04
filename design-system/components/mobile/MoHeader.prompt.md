Headers for the phone: a 52pt bar for pushed screens and a 30pt large title for tab roots.

```jsx
<MoHeader onBack={goBack} title={thread.title} sub="#Volero · builder · Claude Code" right={<MoRoundButton icon="more" label="More" />} />
<MoLargeTitle title="Activity" sub="Friday 23 October" running={4} needs={3} />
```

Web: `components/mobile/MoHeader.jsx`. Expo: `components/mobile/native/MoHeader.tsx`. Styles: `components/mobile/mobile.css`.
