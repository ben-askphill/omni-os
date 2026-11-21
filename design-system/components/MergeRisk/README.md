MergeRiskCard is the merge-risk gate's rating of one head of a thread's PR, in the thread's transcript on desktop web, phone web, the desktop app and the iOS app (`apps/web/src/components/thread/MergeRiskCard.tsx`, `apps/ios/src/components/thread/rows/MergeRisk.tsx`). It tells Ben from the thread whether the PR is safe to merge, without opening GitHub. It is composed of existing parts: the `CloudAgentCard` shell, `Status` pill and `Icon`.

```jsx
<MergeRiskCard p={{ repo: 'ben-askphill/omni-os', pr: 914, url, head: '56597d6e…', level: 'medium', label: 'needs-ben', bullets: ['- **Impact:** 👀 touches `apps/server/sync/`'] }} />
```

## Anatomy

- A `surface` card, 22px radius, 16px by 12px padding, as `CloudAgentCard`.
- First line: a 32px `bg` disc with the check icon (merge-ready) or the PR icon (anything else), then **Merge risk low / medium / high / not rated** (13.5px medium). Low is `fg`, medium `warn`, high `danger-text`, not rated `fg-2`. At the end, the PR's label as a status pill: `merge-ready` on the `done` fill, `needs-<name>` on the `needs` fill.
- Second line (12.5px): **Safe to merge**, **Read the gaps before merging** or **Read it yourself before merging** in `fg-2`, then `PR #914` with the external icon (opens GitHub), then "rated `56597d6`" in mono.
- Under it, set in to the text: one line per area not rated good. The verdict as a small uppercase word (POOR in `danger-text`, DECENT in `warn`), the area in `fg` medium, then the gap in `fg-2`, backticked paths in mono on a `bg` chip.
- A "not rated" card has no gap lines; its reason sits there in `fg-2`.

## Where it sits

- Desktop: in the transcript where the row landed, after the turn that pushed the head.
- Phone web and iOS: under the turn it came after, below run switches and member lines.
- One card per rated head: a new push adds a new card, and the same head never gets two.

Rules in `packages/shared/merge-risk.ts`; the row is written by `apps/server/merge-risk/gate.ts`.
