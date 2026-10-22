# Other ways in

Besides the two clients:

- `scripts/omni.sh "prompt" -c volero -r researcher`: start a thread from the shell (`OMNI_URL` points it at another server)
- claude-bar hotkey prompt: set `"target": "omni"` in its config to send captures here
- Mac app Quick Prompt: Ctrl-Option-Space in any app opens a floating prompt, starts Wispr Flow, and sends what you say to the Conductor. Settings, Quick Prompt changes the shortcut and opens Omni at login
- `npm run import-history -- --days 30`: pull existing Claude Code sessions into Omni as resumable threads
- `npm run brain-export -- [--channel <id>] [--since <YYYY-MM-DD>] [--dry-run]`: write threads as markdown digests into your central brain's `raw/omni/<channel>/` for ingestion. Tool calls never leave Omni, and secrets and token-shaped strings are redacted. Run it on one Mac only
