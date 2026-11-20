# The omni command

`omni` reaches Omni from a terminal: yours, an SSH session, a script, or an agent's shell in any harness. It is a thin client over the same HTTP API the Web UI uses ([ADR 0014](../adr/0014-omni-command-line.md)).

## Getting it

The desktop app installs it each time it starts:

- **In your terminal:** `~/.local/bin/omni`. Claude Code's native installer uses the same folder, so it is often on your PATH already. If `omni` is not found, add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile.
- **For agents:** a second copy in the app's own `bin` folder, which comes last on every thread's PATH, so Claude Code, Codex and Cursor Agent threads have it even when your PATH lacks `~/.local/bin`. Threads without the Conductor's MCP tools are told about it in their system prompt, unless another program named `omni` comes first on PATH.

The command is a small shell script that starts the `omni` binary the app carries, so a call starts in a few milliseconds. It updates when the app does and needs no Node. An app built without the binary (`--native off`) writes no command and removes the one it wrote before.

| | Mac | Linux (AppImage) |
| --- | --- | --- |
| Your command | `~/.local/bin/omni` | `~/.local/bin/omni` |
| The agents' copy | `~/Library/Application Support/Omni/bin/omni` | `~/.config/Omni/bin/omni` |
| What it runs | `bin/omni` inside `Omni.app` | `~/.config/Omni/native/omni`, a copy the app refreshes at each launch |

- **A file already called `omni` there:** the app replaces its own older copies and Omni's old launchers (the Linux service control script, a link to `scripts/omni.sh`). Anything else it leaves alone and notes in the server log. Use the agents' copy by its full path, or move the other program.
- **Moved or updated the app:** the next launch rewrites the command. Until then it says the app is gone.
- **Only the installed app claims it:** a dev run, the QA harness, a `--data-dir` or `--port` launch, or a Mac app run from the disk image never writes `~/.local/bin/omni`.
- **From a checkout without the app** (a server or VPS, or `npm run dev`): `scripts/omni.sh` builds the command with `cargo` into `target/debug` and runs it. It uses the checkout's `data/api-token`. Without `cargo` it says to install Rust from https://rustup.rs and exits 3.

## Commands

| Command | Does |
| --- | --- |
| `omni new "<prompt>" [-c <channel>] [-a <agent>] [-m <model>] [--wait] [--json] [--open]` | Starts a thread as an agent (`--role` and `-r` still work). The prompt can come on stdin |
| `omni send <thread> "<message>" [--queue \| --interrupt] [--wait] [--json]` | Messages a thread. A busy thread reads it at its next step unless you queue or interrupt |
| `omni threads [--needs-you] [--running] [-c <channel>] [-n <count>]` | Lists the latest threads, or what waits on you |
| `omni show <thread>` | A thread's status, machine, branch, what waits on you and its latest reply |
| `omni status [--machine <name>]` | Version, running turns, Needs you, sync and update state. `--machine` reads another synced machine as this Omni sees it, so it needs no route to it |
| `omni doctor` | Checks the install without the server: the port, the token, the data folder, disk space, the Claude, Codex and GitHub logins and the end of the server log |
| `omni open [<thread> \| <channel> \| .] [--pair]` | Opens it in the desktop app, else the browser. `--pair` prints a link that pairs a browser, such as your phone, and opens the page there |

- `<thread>` is the id, its first 8 characters, a link to it, or `parent` inside a thread (the thread that started this one).
- `.` in `omni open` is the thread whose worktree you are in, the thread an agent runs in, or the channel whose folder you are in.
- `--json` on any command prints one JSON object for scripts.
- `omni <command> --help` shows one command.

## Waiting and exit codes

`--wait` blocks until the turn ends, prints the reply on stdout and how it ended on stderr. Ctrl-C stops waiting, not the thread. It keeps waiting through a server restart (an update), and for a thread sent to another machine until that machine has run it.

| Exit | Means |
| --- | --- |
| 0 | Done (`--wait`), or the command worked |
| 1 | The thread failed or was stopped (`--wait`), or a `doctor` check failed |
| 2 | The thread needs you (`--wait`): a question, a usage limit, a worktree that could not be made, messages to resume, or a delegated thread that failed |
| 3 | Omni refused the request, is not reachable, or something else holds its port |
| 64 | The command line was wrong |

```sh
if omni new "run the nightly import check" -c volero --wait > report.md; then echo ok; fi
```

## From an agent

Inside an Omni thread the server sets `OMNI_URL`, `OMNI_TOKEN` and `OMNI_THREAD_ID`, so nothing needs configuring. `OMNI_TOKEN` is the thread's own token, not the install's, and the thread folder (`OMNI_THREAD_DIR`) holds a copy in `token` for a shell whose harness drops variables named like a token. There the command never falls back to `data/api-token`: with no token of the thread's it sends nothing and exits 3. A thread's terminal tab and channel actions are yours, not the agent's, and keep using the install's token. `omni doctor` names the token as the thread's own.

- `omni send parent "blocked on the Directus password"` reaches the thread that started this one mid-turn. Its final reply still reports back on its own.
- `omni new "…" -c volero -a researcher` from inside a thread files the new thread under it, as the Conductor's delegate does, and its report comes back.
- A message from inside a thread counts as the Conductor's, so a thread whose session went cold refuses it, as `message_thread` does.

## Which server gets the token

Without `OMNI_URL`, the command talks to this machine's Omni on its port and first asks it to prove it holds the same token (`GET /api/auth/proof`, as the desktop app does). `omni open --pair` does the same before it prints a link with the token in it. If another install or another program holds the port, the command stops with exit 3 and sends neither the token nor your prompt. With no token found, it sends nothing either. `omni doctor` shows what is there.

- **A data folder's token stays on this machine.** The install's `data/api-token`, which the desktop app's command and `scripts/omni.sh` use, and the one in `OMNI_DATA_DIR` go only to a server here that proves it holds them. That includes an `OMNI_URL` on loopback, such as a QA server. They never go to another machine.
- **Another machine needs its own token** in `OMNI_TOKEN` or `OMNI_TOKEN_FILE`. Without one the command stops with exit 3 and sends nothing.
- **Plain `http://` stays on this machine or your tailnet.** An `http://` `OMNI_URL` has to be loopback or a Tailscale address (`100.64.0.0/10`, `fd7a:115c:a1e0::/48` or a `.ts.net` name), because Tailscale encrypts the link. Anything else needs `https://`, or the command stops with exit 3 and sends nothing.
- **`omni open --pair` through your own Tailscale address.** A pairing link for this Mac's `.ts.net` name or `100.x` address ([Remote access](remote-access.md)) needs no `OMNI_TOKEN`. The command checks with `tailscale status` that Tailscale is running and the address is this Mac's own, then that the server behind it proves it is this install (it signs its proof with its own port), and prints the link only then. Any other address, another tailnet machine or an Omni Connect one included, needs `OMNI_TOKEN`: a server there could hand on the proof from one of this Mac's addresses.

## Another machine

`OMNI_URL` points the command at another Omni, such as the other Mac over Tailscale, with that machine's token in `OMNI_TOKEN`. Use its `https://` address, or over Tailscale its `.ts.net` name or `100.x` address. `omni open` then uses the browser. For a quick look without a token, `omni status --machine <name>` reads what sync already brought here.

## Scope

The command has the six areas above (`threads` and `show` count as one) and no more. Everything else (automations, secrets, PRs, machines, updates) stays with the Web UI and the Conductor's MCP tools. A new feature does not get a command; see [ADR 0014](../adr/0014-omni-command-line.md).
