# Omni OS — UI kit

High-fidelity click-through of the Omni OS workspace, composed from the design-system components (`window.OmniOS` via `_ds_bundle.js`, with `assets/ds-fallback.js` compiling sources in-browser if the bundle isn't built).

- `index.html` — desktop app. URL params: `screen=conductor|channel`, `theme=light|dark`, `density=compact`, `palette=1&q=…`.
  - Conductor thread: user ask → tool calls → delegation to researcher (done), builder (running), store-ops (needs you) → researcher report with inline HTML artifact → follow-up. Click **Pause automation** to resolve the decision (the rail mark relaxes from attention to delegating). Type in the composer and press ⏎.
  - Channel (Volero): 42 threads grouped Needs you / Running / Just done / by date; filters; channel panel (automations, browser sessions, usage, repos).
  - ⌘K palette (# channels, T- tasks, > commands), theme and density toggles.
- `phone.html` — Conductor thread on iPhone, light + dark.
- `cards/` — iframe previews (light/dark per screen, palette, compact) and starting points.
- Files: `App.jsx` (shell), `ConductorScreen.jsx`, `ChannelScreen.jsx`, `PhoneConductor.jsx`, `data.js`, `ios-frame.jsx` (device bezel starter).

Note: no Omni OS product code or screenshots were provided — these screens are the proposed design from the brief, not a recreation.
