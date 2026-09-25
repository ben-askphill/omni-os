# Codex threads run on `codex app-server`, not `codex exec`

Omni drives Codex through `codex app-server` (JSON-RPC over stdio), even though OpenAI marks that protocol experimental and `codex exec --json` is the stable interface. Only app-server fits how Omni treats a thread: one warm process per thread, steer mid-turn (`turn/steer`), interrupt without losing the session (`turn/interrupt`), inline image input, and live rate-limit updates for the usage meter. `exec` starts a process per turn and can do none of the live controls, so Codex threads would behave like Cursor threads.

## Consequences

- The protocol can change between Codex releases. Omni runs the standalone CLI from Homebrew (`codex` on PATH, or `OMNI_CODEX_BIN`), which only updates on `brew upgrade`, rather than the alpha build bundled in ChatGPT.app, which updates with the app.
- The contract tests pin the message shapes Omni depends on. A Codex upgrade that breaks them should fail there first, not in a live thread.
