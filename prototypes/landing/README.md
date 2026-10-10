# Omni OS landing page (prototype)

Standalone marketing page prototype. One self-contained HTML file, no build step. Open `index.html` in a browser.

- Hero, a 6-column bento grid of animated mini mockups of the real UI, how it works, final CTA.
- Mockup colors and labels come from `web/src/index.css` and the web components.
- Animations run only while a card is on screen and show a finished still frame under `prefers-reduced-motion`.
- Not wired into the app; nothing in `web/`, `mac/` or `server/` imports it.
