# Other ways in

Besides the two clients:

- The `omni` command: `omni new "prompt" -c volero -r researcher [--wait]` starts a thread from any terminal, and `send`, `threads`, `show`, `status`, `doctor` and `open` do the rest. The desktop app puts it on your PATH and on every thread's. `omni open --pair` prints a link that pairs a browser, such as your phone. See [The omni command](cli.md)
- MCP from other apps: Claude Desktop, claude.ai, ChatGPT, Cursor, Codex and Grok list, start and steer threads through Omni's MCP server. `npm run mcp:config` prints the setup; see [Omni as an MCP server](external-mcp.md)
- claude-bar hotkey prompt: set `"target": "omni"` in its config to send captures here
- Desktop app Quick Prompt: Ctrl-Option-Space (Ctrl+Alt+Space off the Mac) in any app opens a floating prompt that starts a thread, in the Conductor's channel unless you pick another. Return starts the thread, Cmd-Return (Ctrl-Return off the Mac) also opens it. Settings > Desktop app turns it on or off, changes the shortcut, starts Wispr Flow on a Mac and opens Omni at login. On Linux under Wayland the shortcut needs the desktop portal and a binding in the compositor
- Desktop app Go > Overview (Shift+Cmd+H / Shift+Ctrl+H) opens Overview. Go > Inbox opens the Inbox: the same dashboard, with the Inbox list beside it in the channel rail's panel, or in the Classic sidebar, which switches to its Inbox view
- Desktop app Activity Monitor (macOS Window menu): live token throughput and system resources from `prototypes/activity-monitor`. It reads Claude transcripts from `~/.claude/projects` only, because Omni strips `CLAUDE_CONFIG_DIR` from Claude Code threads so they always write there
- `npm run import-history -- --days 30`: pull existing Claude Code sessions into Omni as resumable threads
- `npm run brain-export -- [--channel <id>] [--since <YYYY-MM-DD>] [--dry-run]`: write threads as markdown digests into your notes folder's `raw/omni/<channel>/` for ingestion. Tool calls never leave Omni, and it redacts secrets and token-shaped strings. Run it on one Mac only
