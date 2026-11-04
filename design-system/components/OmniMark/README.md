The fluid Omni mark; use at splash, in the rail’s Conductor row, and anywhere the Conductor’s state should be felt.

```jsx
<OmniMark size={48} state="delegating" droplets={3} />
<OmniMark state="attention" onAcknowledge={ack} />
```

states: idle · hover · thinking · delegating · report · attention. `time` freezes a keyframe. StaticMark for ≤24px and print; `ring` drops the droplet at 16px.
