# Mods

Claude Code mods are plugins of function hooks (Claude Code 2.1.287 and later, early access). The repo ships them in `mods/`. With `OMNI_MODS=1` in `.env`, every Claude Code thread's process starts with `--plugin-dir` for each one; the flag is off by default for now. Nothing is installed in `~/.claude`.

| Mod | What |
| --- | --- |
| `omni-progress` | Keeps a status line for the running turn (`Edit: src/foo.ts · 4 tools · 2m 10s`) and a summary when it ends (`Done · 7 tools · 1m 3s`). A watchdog toasts and logs when one tool call runs past 5 minutes, or the same tool fails 3 times in a row with the same input. It only observes: every hook passes the call through, and a failing hook passes it through too |

Under `-p` stream-json these come out as `system` events with subtype `ui_status`, `ui_toast` and `ui_log`.

- Bash is not watched by default. Any `tool.call` hook that matches Bash breaks subagents spawned with `isolation: "worktree"` (Claude Code bug #92533), so omni-progress names the other tools in its matcher. Its `watchBash` option turns Bash on; leave it off until that bug is fixed.
- Thresholds are `userConfig` options (`slowCallMinutes`, `repeatFailures`, `watchBash`), read from `pluginConfigs.omni-progress` in Claude Code settings.
- Hot reload is off under `-p`. A changed mod reaches a thread only once its warm process restarts (after `OMNI_KEEPALIVE_SECONDS`, or a server restart).
- Checks: `claude plugin validate mods/omni-progress` and `claude plugin test mods/omni-progress`. Neither type-checks; run `tsc` against the `claude-code.d.ts` the `plugin-authoring` skill writes.
