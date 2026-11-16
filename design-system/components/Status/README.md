Status pills and the plain status words. Every mark comes from StatusDot (18 states); see its card for the full legend.

```jsx
<Status state="running" />
<Status mark="review" />
<Status state="limited" label="Limited · resumes 21:00" />
<StatusGlyph state="failed" />
```

Plain words map to marks: running is the filled blue disc with a halo, needs the filled vermilion diamond, limited the hollow amber square, failed the red cross, done the volt disc with a tick, settled and stopped the grey bar, queued the grey dashed ring, idle the small grey dot. Pass `mark` for any of the 18 (Starting, Waiting on crew, Checks running, Ready for review and the rest). A failed pill is `role="alert"`. Never "Working", "Input" or "Finished", and never "Failed" for a usage limit; a finished thread you haven't opened is Done plus an unread mark, not Needs you.
