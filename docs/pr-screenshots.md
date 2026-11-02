# Screenshots on PRs

Every PR for a feature or fix that changes what the Web UI, the desktop app or the Mac app looks like carries screenshots in its description. A change that only moves pixels by accident (a refactor, a dependency bump) needs them too once you notice it. Backend, test and tooling PRs with no visible change don't.

## What to capture

- The screen or component that changed, cropped to it or shown in context, whichever reads better.
- Before and after for a fix or a restyle. Take "before" from `main` (or before your first commit), not from memory.
- Light and dark when the change touches colour, tokens or theming.
- Every surface: desktop web, phone web (390px) and the desktop app (`apps/desktop`). Skip one only when the PR says why it does not change there. Until the cutover deletes `apps/mac` (ADR 0010), a change that also touches `apps/mac` carries Mac app screenshots too.
- States that matter: empty, loading, error, long content, hover or open menus.

## How to capture

- Never screenshot against the live server on :4747 or its `data/`. Start a throwaway server on a spare port with its own data dir and the fake CLIs (`QA_SERVER_PORT=<port> scripts/qa-stack.sh up`, which seeds sample threads), and point the client at it.
- Web: run vite against it (`OMNI_PORT=4757 npx vite --config apps/web/vite.config.ts --port 4768`, any free port) and use the thread's browser (`omni-browser` MCP) or Playwright: `browser_resize` for phone width, `browser_emulate_media` for dark mode.
- Desktop app: `apps/desktop/scripts/qa.ts` with `snapshot` steps and `"appearance": "light"` or `"dark"`, described under "QA harness" in `apps/desktop/README.md`. It launches the app with Playwright against the stack's server and captures windows without screen recording permission. Pass `--app-url` with a Vite in front of the stack so the app shows your Web UI change, not the server's last build of `apps/web/dist`.
- Mac app, until the cutover: the Debug app's QA harness (`-OmniQAScript` with `snapshot` steps, `-appearance light` or `dark`), described in `apps/mac/NOTES.md`.
- Name files after what they show, like `composer-after-dark.png`. The name becomes the alt text.

## How to attach

GitHub has no API for uploading images to a PR, so upload them with:

```
scripts/pr-screenshots.sh shots/*.png
```

It commits the images to the hidden ref `refs/screenshots/pr-screenshots` under a folder named after the current branch and prints one Markdown image line per file, pinned to that commit. Paste those under a `## Screenshots` heading in the PR body, grouped as before/after, with a line on what to look at. After review fixes, re-run it and replace the old lines with the new ones: the links point at a commit, so the old ones keep showing the old images.

The ref sits outside `refs/heads` on purpose. Pushing to a branch made GitHub show a "pr-screenshots had recent pushes, Compare & pull request" banner on the repo page after every upload. The old `pr-screenshots` branch stays so images in older PRs keep loading; nothing pushes to it any more.

Copy the images to the thread's artifacts folder as well, so you see them in the thread.

If screenshots can't be taken (the app won't build, no display), say so under `## Screenshots` and why, rather than leaving the section out.
