# claude.ai Artifacts

The Artifacts page has two lists: **Files** (what threads wrote on this machine) and **claude.ai** (your Artifacts on claude.ai, the same list as the Artifacts tab of the Claude app). On a phone, the Library tab has the same switch. Open it from the switch, `#/artifacts/claude`, or "claude.ai artifacts" in the command menu. The Conductor reaches the list with `list_claude_artifacts` and `refresh_claude_artifacts`.

## How the list is made

There is no public Artifacts API. Omni asks the claude CLI on the machine running Omni to list them with its own Artifact tool, under your claude.ai login: one short Haiku run, with a guard that blocks anything but listing. Omni keeps the last good list, so the screen works when the CLI does not. Each row shows its type (Page for plain HTML, else Slides, Doc, Design, Dashboard and so on), whether it is yours or shared, the date claude.ai last updated it (your own pages only), and the thread that published it when an Omni thread did.

- **When it refreshes:** when you open the list and the last try is over ten minutes old, whenever you press Refresh (or pull down on iOS), and on the schedule under the list: Daily (default), every 6 hours, or Off. Type badges are mapped once a day.
- **Cost:** each run is a fraction of a cent of your Claude plan's usage, a few seconds long.
- **Opening one** leaves Omni: a new tab in a browser, your default browser from the desktop app, the Claude app or Safari on an iPhone. You need to be signed in to claude.ai there.

## When it says something is wrong

| Message | What to do |
|---|---|
| Claude Code is not installed here | Install the claude CLI on the machine running Omni (`OMNI_CLAUDE_BIN` points elsewhere). |
| Claude Code is signed out | Run `claude`, then `/login`, on that machine. |
| The Artifact tool is not available | Sign Claude Code in with your claude.ai account, not an API key. |
| Usage limit reached | Refresh once the limit resets. |
| Claude Code changed its output | A CLI update changed the list's text. The last list stays; open the gallery on claude.ai meanwhile. |

Artifacts shared from another organization are not listed. `OMNI_CLAUDE_ARTIFACTS=0` turns the schedule off for a server (QA stacks, tests). Why it works this way: [ADR 0011](../adr/0011-claude-artifacts-list.md).
