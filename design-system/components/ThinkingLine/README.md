The running turn's thinking line, under the newest row while a thread runs, tool calls included: the running StatusDot in the turn's phase (Starting, Running or Running a tool, each with its halo), the label shimmering, and the time since Ben's last message in tabular figures. The label is "Thinking" or the agent's newest status since that message (`statusLabel` in `packages/shared/status-line.ts`), cut with an ellipsis when it does not fit. A queued turn shows "Waiting for a free slot" instead, and a question waiting on Ben replaces the line.

The shimmer: a vermilion highlight sweeps left to right across `--fg-4` text, 1.75s on `--ease-fluid`, forever. The gradient is 4.8 times the label's width, moves from background-position 115% to -15% and repeats; its stops mix `--fg-4` and `--fg-3` into `--vermilion` (`packages/shared/shimmer.ts` holds the numbers, and the web's `.shimmer-text` is tested against them). Reduce Motion stops the sweep and the halo: the label is plain `--fg-3` and the dot holds still. The Omni mark no longer appears here (PR #755).

Desktop: bare, 12.5px. Phone web and iOS: a `--surface` card, 14px, 14px across and 12px down.

```jsx
<ThinkingLine label={status ?? 'Thinking'} since={turnStartedAt} phase={turnPhase(rows)} />
```

iOS (`apps/ios/src/components/thread/rows/ThinkingRow.tsx`) draws the glyphs as SVG text clipping three gradient tiles that Reanimated slides under them, and keeps its own mark on the UI thread: the native app is outside PR #755.
