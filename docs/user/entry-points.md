# Other ways in

Besides the two clients:

- `scripts/omni.sh "prompt" -c volero -r researcher`: start a thread from the shell (`OMNI_URL` points it at another server, `OMNI_TOKEN` or `data/api-token` is the API token)
- `scripts/omni.sh --pair`: print a link that pairs a browser, such as your phone, with this Omni
- MCP from other apps: Claude Desktop, claude.ai, ChatGPT, Cursor, Codex and Grok list, start and steer threads through Omni's MCP server. `npm run mcp:config` prints the setup; see [Omni as an MCP server](external-mcp.md)
- claude-bar hotkey prompt: set `"target": "omni"` in its config to send captures here
- Desktop app Quick Prompt: Ctrl-Option-Space (Ctrl+Alt+Space off the Mac) in any app opens a floating prompt that starts a thread, in the Conductor's channel unless you pick another. Return starts the thread, Cmd-Return (Ctrl-Return off the Mac) also opens it. Settings > Desktop app turns it on or off, changes the shortcut, starts Wispr Flow on a Mac and opens Omni at login. On Linux under Wayland the shortcut needs the desktop portal and a binding in the compositor
- `npm run import-history -- --days 30`: pull existing Claude Code sessions into Omni as resumable threads
- `npm run brain-export -- [--channel <id>] [--since <YYYY-MM-DD>] [--dry-run]`: write threads as markdown digests into your central brain's `raw/omni/<channel>/` for ingestion. Tool calls never leave Omni, and secrets and token-shaped strings are redacted. Run it on one Mac only
