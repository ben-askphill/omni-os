# Screenshots on PRs

Every PR for a feature or fix that changes what the Web UI or the Mac app looks like carries screenshots in its description. A change that only moves pixels by accident (a refactor, a dependency bump) needs them too once you notice it. Backend, test and tooling PRs with no visible change don't.

## What to capture

- The screen or component that changed, cropped to it or shown in context, whichever reads better.
- Before and after for a fix or a restyle. Take "before" from `main` (or before your first commit), not from memory.
- Light and dark when the change touches colour, tokens or theming.
- For the Web UI, desktop width and phone width (390px) when the layout could differ.
- Each client the change touches: a web and Mac change needs shots of both.
- States that matter: empty, loading, error, long content, hover or open menus.

## How to capture

- Never screenshot against the live server on :4747 or its `data/`. Start a throwaway server on a spare port with its own `OMNI_DATA_DIR` and the fake CLIs (the command is under "QA harness" in `mac/NOTES.md`), seed it with sample threads, and point the client at it.
- Web: run vite against it (`OMNI_PORT=4757 npx vite --port 4768`, any free port) and use the thread's browser (`omni-browser` MCP) or Playwright: `browser_resize` for phone width, `browser_emulate_media` for dark mode.
- Mac: use the Debug app's QA harness (`-OmniQAScript` with `snapshot` steps, `-appearance light` or `dark`), described in `mac/NOTES.md`. It snapshots windows without screen recording permission.
- Name files after what they show, like `composer-after-dark.png`. The name becomes the alt text.

## How to attach

GitHub has no API for uploading images to a PR, so upload them with:

```
scripts/pr-screenshots.sh shots/*.png
```

It commits the images to the orphan `pr-screenshots` branch under a folder named after the current branch and prints one Markdown image line per file. Paste those under a `## Screenshots` heading in the PR body, grouped as before/after, with a line on what to look at. Re-running with the same file names replaces the images, so update them after review fixes.

Copy the images to the thread's artifacts folder as well, so Ben sees them in the thread.

If screenshots can't be taken (the app won't build, no display), say so under `## Screenshots` and why, rather than leaving the section out.
