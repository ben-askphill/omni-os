# Harnesses

A harness is the AI CLI a thread runs on. Pick one per channel (its default) or per thread in the model picker, or leave it to [Auto](#auto). Each runs through its official CLI and bills the plan it is signed in to. Cursor Cloud is the exception: it runs off the Mac and Omni talks to it over HTTP. [Accounts](#accounts) shows which account each one is signed in to on each machine.

Hermes and the AI agents on servers of your own are not harnesses you pick. Each is a [remote agent](crew.md#remote-agents): you mention it, seat it in a thread or start a thread as it, and its server is a detail of the agent ([ADR 0020](../adr/0020-remote-agents-are-agents.md)). [Remote agents' servers](#remote-agents-servers) below says how Omni talks to them.

| Harness | Bills | Install and sign in | Runs as |
| --- | --- | --- | --- |
| Claude Code | Claude plan | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` | `claude -p` with stream-json |
| Codex | ChatGPT plan | `npm install -g @openai/codex && codex login` | `codex app-server` ([ADR 0001](../adr/0001-codex-app-server.md)) |
| Cursor Agent | Cursor plan | `curl https://cursor.com/install -fsS \| bash && cursor-agent login` | `cursor-agent` |
| Cursor Cloud | Cursor plan | Secret `CURSOR_API_KEY`, see [below](#cursor-cloud) | A Cursor cloud agent, through the Cloud Agents API |

- `OMNI_CLAUDE_BIN`, `OMNI_CODEX_BIN` and `OMNI_CURSOR_BIN` in `.env` point at a binary that is not on `PATH`. Without one, Codex also tries the copy inside the ChatGPT app.
- A harness Omni can't use shows why in the model picker, Settings > Models and the error `delegate` gets. Claude Code is asked with `claude auth status --json`: signed out reads as `claude auth login`, no `claude` on `PATH` as missing, and a CLI too old to answer stays available. For Codex that is one of: signed out (`codex login`), signed in with an API key, no `codex` on `PATH`, a binary that won't run, `codex app-server` exiting before it answers (with the last line it printed), or no answer to a request. A server busy with disk writes does not count as no answer.
- The Usage card (desktop web and the desktop app; phone and iOS have none) has a row per signed-in account, and each limit says when it resets ("in 2h 10m"; hover or tap for the local time). Claude's rate-limit events drive the 5h and week windows, Codex reports its own, and Cursor's dashboard gives the monthly cycle. Hermes and Cursor Cloud have no plan limit to show. A window whose source sent no reset time shows no reset. An account with no reading of its own yet says **no reading yet** (and never borrows another account's numbers); a stale or missing reading on a lone account still says **no data**.
- Each harness has its own concurrency cap (12 by default): `OMNI_MAX_CONCURRENT` (Claude Code), `OMNI_MAX_CONCURRENT_CODEX`, `OMNI_MAX_CONCURRENT_CURSOR`, `OMNI_MAX_CONCURRENT_HERMES`, `OMNI_MAX_CONCURRENT_CURSOR_CLOUD`. A full harness never holds up threads on another.
- Each harness drops variables that would move it off the signed-in plan or away from the login Omni expects (`apps/server/harness/env-guard.ts`). Claude Code drops `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `CLAUDE_CONFIG_DIR` (so traffic and transcripts stay on `~/.claude`). Codex drops `OPENAI_API_KEY`, `CODEX_API_KEY` and `OPENAI_BASE_URL`. Cursor and Cursor Cloud drop `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`. Every harness drops `HERMES_API_KEY`, and no harness, terminal or channel action gets a remote agent's key (a secret its server's file names): those keys go only to that server's HTTP client. The guard wins over the server environment, a channel or global secret, and any extras, so a secret with one of those names never reaches that harness. A thread's terminal drops the union of every harness list. A login shell profile still runs, so a value exported there can come back.
- Cursor Agent streams partial reply text into one Markdown message as it writes, and tool rows show the call name and path, command or pattern when they start. It still cannot steer or interrupt a running turn. Messages sent mid-turn wait for the next one ([Sending while a thread is busy](threads.md#sending-while-a-thread-is-busy)).
- Some features are Claude Code only: published artifact cards, [mods](mods.md) and [`/goal`](threads.md#goals).
- Claude Code's model picker includes Fable 5.2 (`claude-fable-5-2`, between Sonnet 5 and Fable 5.1). The `fable` alias resolves to 5.2.

## Models in the picker

Omni asks each harness which models it has, so a model that ships in a new CLI release shows up without an Omni update: Claude Code's `initialize` answer (nothing goes to the API), Codex's `model/list`, `cursor-agent --list-models` and Cursor's `/v1/models`. Claude Code keeps Omni's bundled list first and adds whatever else it reports. Hermes has one model.

- Omni asks at start and every 15 minutes. A picker that opens on a list older than 5 minutes asks again in the background, so the next open has the new models. **Check for new models** in Settings > Models asks at once.
- What Claude Code last reported is kept in `data/claude-models.json`, so a restart starts from it. When Claude Code does not answer, the last list stays.
- **Models in the picker**, in the same section, chooses per harness which models the pickers list (desktop, phone and iOS). By default each harness shows the newest model of each family and its default: when Opus 5.6 ships it shows and Opus 5.5 drops out. **All** shows every model. A switch on a model wins over the rule, and **Reset** clears them. The choice syncs to your other machines.
- A hidden model still runs. A thread, agent, channel default or automation that names one keeps it, the picker still shows it while it is the one picked, and Auto picks from every model. The Conductor's `list_harnesses` marks it `hidden`.

## Accounts

Settings > Accounts lists every synced machine, each harness on it, and the account it is signed in to. The model picker names the account in each harness's heading, for the machine the new thread will run on, and the Machine chip adds it to each machine's row. Each machine reads its own harnesses and syncs the result, so a row for another machine is as that machine last reported it.

| Harness | Read from | Shows |
| --- | --- | --- |
| Claude Code | `claude auth status --json` | Email, organization, plan (`Max`, `Team`) |
| Codex | `codex app-server`'s `account/read` | Email, plan, workspace. An API key login reads as signed out: Omni runs Codex on the ChatGPT plan only |
| Cursor Agent | `cursor-agent about --format json` | Email, tier |
| Cursor Cloud | `GET /v1/me` with the global `CURSOR_API_KEY` | The email the key belongs to, and the key's name |
| Hermes | Nothing | The server it bills. It bills an Anthropic key set on that server, which Omni cannot see |

- Every check runs with the environment the harness itself gets, so it reports the account a thread would bill. A check is read-only: it never logs in, refreshes a token or writes a file.
- Only the email or name, org and plan leave a check. A field shaped like a token or key is dropped before it reaches a response, a log or the synced record (`apps/server/harness/accounts-parse.ts`).
- A machine reads again when the list is opened after a minute, on Check again, and after a sync once ten minutes have passed.
- When a harness signs in as another account than the last one it had, Omni shows the switch: in the sidebar (Activity on a phone), at the top of Settings > Accounts, and under the new-thread composer when that harness is picked for that machine. Got it clears it on every client and machine. Signing out and back in to the same account is not a switch. Neither is a new plan on the same account.
- A thread keeps the account its harness ran as when its process last started. The thread header shows it (beside the crumbs on desktop, after the harness on a phone, beside the machine on iOS), and the quick-actions card shows it with the machine when it ran on another one. Cursor Cloud on a channel's own key is not stamped, since that key is not the machine's.
- The Conductor reads the same list with `harness_accounts`.

## Switching mid-thread

The model and effort pickers in a thread's reply box move it to another model, effort or harness. Switching does not work to or from Cursor Cloud, which has no worktree on this Mac, or in a thread a remote agent leads, whose run is its server's. A Cursor Cloud thread keeps the model its agent started with.

- Between turns the switch applies at once.
- While a turn or its background tasks run, the switch waits. The pills show the pick with "Next turn" until the turn ends, however it ends (done, failed or stopped), and its background tasks finish. Then the switch applies. A later pick replaces it; picking the current model and effort again, or the pill's clear button, drops it. Anything you send meanwhile waits for the turn too and runs on the new pick, instead of steering the running turn.

- A thread another synced machine runs switches the same way: a pick made while it runs a turn there waits for that turn, and that machine applies it ([Sync](sync.md#run-a-thread-on-another-machine)).
- Stop keeps the queued switch; clear Next turn to cancel it. If the pick is no longer available when it applies, Omni drops it with an error row and keeps the current run.
- Same harness: its session carries on with the new model or effort.
- Another harness: your next message starts a session there with a handover ahead of it. Omni builds it from the thread's transcript: title, folder, artifacts, open todos, then the messages, replies and tool calls, the newest kept whole when it runs past 32K characters. The transcript shows "Handing over from ... to ...", then how much the new session read. A message that starts with a command, like `/review`, runs first, and the handover goes with your next message.
- Back to a harness the thread ran on before: its own earlier session resumes and reads only what happened since. Switching straight back before anything ran on the other harness needs no handover.
- The Conductor can do the same with `switch_thread_run`, when you ask it to.

## Continuing on another harness

A switch keeps one thread. To leave a thread as it is and carry on in a new one, use **Fork thread** (the branch icon in the reply box, under + on a phone, or the thread's menu). The new thread is linked both ways ("Continued from" and "Continued in"). It gets its own session on the harness, model and effort you pick, and its own worktree. The source thread, its session and its checkout stay as they were.

- You can continue only an idle thread. Nothing may be running in it: no turn, background task or delegated thread, no queued messages, no scheduled limit resume, no open Terminal shell (the sheet offers to close it). The sheet still shows the preview and says what is in the way. Messages waiting for Resume don't block; the carryover lists them as not sent.
- The preview shows the **carryover**, what the new session reads ahead of your message: the thread's goal, constraints, changed files, the checks it ran, then its history. The newest history is kept whole and older entries are shortened to their first line. Whatever does not fit the 24K-character budget is listed as left out, with where the new session can read it. Your message comes after the carryover and is never cut.
- For repo work, Omni snapshots the source's worktree the way it saves a turn: HEAD, every tracked change and untracked text file git does not ignore. The new branch starts at the source's HEAD with those changes laid in, uncommitted. Omni does not copy ignored files such as `.env`, or binary or large untracked files; the preview lists the ones it left out. A source that runs in the channel's own checkout (worktree per thread off) shares it with you and other threads, so its uncommitted changes are listed, not copied, and the new thread still gets a worktree of its own.
- Paths from the source's checkout reach the new session relative to the repo root, so it works in its own worktree. Older history it left out is readable as text at `GET /api/threads/:id/transcript`, and the carryover says how. This is separate from `/history`, which serves pages of events to the clients.
- If the source changes between the preview and Start (a new message, a turn, an edit to its files), Omni refuses Start and the sheet shows the new preview.
- **Attachments** from the source are listed with their name, type, size and whether Omni still has the bytes. None goes unless you tick it. Omni copies a ticked file into the new thread's own uploads folder, and it arrives with your first message the way any attachment does: images inline on Claude Code and Codex, and as a path to the file on Cursor Agent (the sheet says which). The new thread never points at the source's folder. A file that is missing on this Mac (for example attached on the other Mac), over the upload limit, past the 4-files'-worth total, a link instead of a file, or changed since it was attached stays on the list with its reason, and the carryover names it as not carried. Cancelling the sheet copies nothing, and a retried Start gives the same thread and the same files.
- A message that starts with a command, like `/review`, runs first, and the carryover goes with your next message.
- Cursor Cloud and remote agents can't take a continued thread, and a thread running on them can't be continued, since they run on another machine.
- The fork runs on the machine picked under **Run on** in the sheet. It opens on Settings > Threads, Run new threads on, and lists your synced machines only (no Grok Bot); with no other machine synced it is hidden and the fork follows that setting. Whenever the fork runs on another machine than the source ran on, picked or by the setting, the carryover says so in a `Machine:` constraint, so the preview changes with the machine. The Conductor's `continue_thread` takes the same choice as `device`. When the fork runs on another machine, Omni makes the fork here and sends it there with your message, its files and, for repo work, the source's snapshot, which that machine lays out as the fork's worktree before its setup action runs. The preview names that machine under Carryover. While it is offline, the preview says so and Start stays off. If the other machine cannot take it, the fork stays here, and Retry (repo work) or Resume runs it on this machine. See [Run a thread on another machine](sync.md#run-a-thread-on-another-machine).
- A synced thread that works in a folder (no branch) can be forked on a Mac that doesn't have that folder: the new thread starts in the channel's folder, as any new thread does. A thread running on your other Mac can't be forked until it finishes there. A thread whose worktree is not on this Mac (made on the other one, or removed by a cleanup) forks from the last commit of its branch, here or on origin, and its uncommitted changes stay behind. When that branch is gone too, for example deleted after its PR merged, the fork starts in the channel's folder like any new thread. The sheet says which.
- A fork of a delegated thread stays that delegation: it keeps the source's parent, task id and follow-up setting, nests under the same Conductor thread, and its report goes back there. Any other fork reports to nobody.
- The Conductor can do the same with `continue_thread`, when you ask it to, and on its own when it has a follow-up for a thread whose session went cold ([Crew](crew.md)). It names the attachments to carry, and the answer says which went and why the others did not.

## Auto

Auto is the first entry in the model picker and the default for a new thread. Omni reads the first prompt and picks the harness, model and effort for it. The thread's model pill then reads "Auto · <model>", and hovering it shows why, for example "Hard code task: Opus 5.5, high effort". Once picked, it is the thread's run like any other, and [switching](#switching-mid-thread) it drops the "Auto".

- It sorts the prompt into a kind (code, math, research, writing, ops, quick) and scores how much it asks: its length, the code it names, and cues such as a migration, a race, a typo or a lookup. Light work runs on Haiku, standard on Sonnet, hard on Opus at high effort, the hardest on Opus at xhigh. Code and math never start below Sonnet.
- It also reads what the brief needs, and that can pick the harness. First match wins:

| Brief | Runs on |
| --- | --- |
| Make an image | Codex |
| Mail, calendar, Notion, Slack | Claude Code |
| Review a PR or code | Codex |
| Claude plan 90% used | Codex |
| Both plans 90% used, code | Cursor Composer |
| Quick or bulk code change | Cursor Composer |
| Anything else | Claude Code |

- Image generation goes to Codex because it is the only harness here that makes images; the image shows in the thread's artifacts. If Codex is not signed in, the thread runs on Claude Code and the Auto note says there is no image generation.
- Your claude.ai connectors (Gmail, Calendar, Slack, Productive, the Portal) exist only in Claude Code, so that work stays there even when the plan is busy. Notion briefs go there too, though threads reach Notion through `OMNI_NOTION_TOKEN` in any local harness ([Notion](notion.md)).
- A review goes to Codex, always at high effort, so a different model family checks work Claude most likely wrote. The Conductor's PR reviews skip Auto and pick the family from the builder's model ([Crew](crew.md)).
- "Quick", "fast", "asap" and the like lower the effort a step on any harness. For code, they also move the thread to Cursor's Composer, a fast and cheap coding model, as does a mechanical change across many files ("rename X across the repo"). This does not happen for the hardest tasks, or when the first message has images, which Cursor Agent cannot see.
- Composer only runs while Cursor's Auto and Composer usage is under 90%. Auto never picks Grok, Gemini or Cursor's other named models, Cursor Cloud or a remote agent. [Auto routing](../internals/auto-routing.md#lanes) explains why.
- A model picked on the thread, an agent's or a channel's default all win over Auto. Set a channel's default to Auto in its settings, or `model: auto` in an agent's frontmatter.
- In #conductor, a saved channel default takes precedence over the Conductor agent's charter. New thread follows saved settings until you pick a model or effort for that draft. Other agents keep their own defaults ahead of the channel's.
- How well it picks, and how to check that again: [Auto routing](../internals/auto-routing.md).

## Remote agents' servers

A [remote agent](crew.md#remote-agents) runs on a server outside Omni, which Omni reaches over HTTP with its key. Its threads run on harness `hermes` (Hermes) or `custom:<slug>` (a server you connected), but no picker lists those: Settings > Models > Harnesses, the model picker, the phone's model sheet and the Conductor's `list_harnesses` show local harnesses only. Settings > Agents lists the agents, with a **Remote** tag, and **Add remote agent** connects a new one ([Remote agents](crew.md#remote-agents)).

A thread a remote agent leads still gets the worktree a local thread would, at the start, so local agents seated in it change files there and you commit them. A thread from before keeps only its own data folder, as it always had.

A remote agent never changes the thread's files. In a channel with **Remote agents can see this channel's work** on ([Channel settings](configuration.md#where-things-live)), Omni offers it a read tool on each turn: list, read and search the thread's git-tracked files, and read the thread's diff and changed-file list. Elsewhere it reads none of them.

- **Only git-tracked files.** Untracked and ignored files read as absent, in a list, a search and the diff alike, so `.git/`, an ignored `.env` and the channel's copied and shared files stay hidden. A file a local member made shows once it is staged or committed.
- **Text only, up to 1 MB.** A binary file is refused. A larger text file, search or diff comes back cut to 1 MB, with a note saying so.
- **Inside the worktree.** A path outside it (`../`, an absolute path) is refused, and so is a symlink that leads out of it.
- **One turn.** The read works only during the turn Omni offered it on, through a key held in Omni's memory that the server never sees. It closes when the turn ends and when Omni restarts.
- **In the thread.** Every read shows as a tool row under the agent's reply (Read, Glob, Grep or Diff), and a refused one says why.
- **Its server takes part.** A Runs API server gets the tool on each run and asks for reads with the protocol's [read call](../internals/remote-harness-protocol.md#the-read-call). An eve agent serves an `omni_worktree` tool of its own that waits for Omni's answer. A server that does neither keeps working, without reads.

### Hermes

Hermes is an always-on AI service on your own Linux server, and the agent `hermes` here. Omni does not spawn it. The Hermes API server listens on the server's Tailscale address and is not public. Omni talks to it at `OMNI_HERMES_URL`, the server's Tailscale address and port (set it in Settings > Extras or `npm run setup`; empty means Hermes is off). The Mac must be on the tailnet. Its agent's Server card shows the address and links to Extras to change it.

The bearer token is the global secret `HERMES_API_KEY` (or a channel secret of that name). It is not an env var or a database column, Omni never writes it to logs, and no local thread, terminal or channel action gets it.

| Piece | What |
| --- | --- |
| Where it runs | On the Hermes server, in whatever clone Hermes already has. The thread's worktree is on this machine, for the local agents seated in it, and Hermes reads it only through the read tool where the channel allows it |
| Session | `omni-<thread id>`. The same id continues the conversation, with Hermes' own context |
| Prompt | Who it is and that it talks only, plus its charter when you wrote one, go in `instructions` on the first run. The transcript shows only what you typed |
| Steer / interrupt | `POST /v1/runs/{id}/steer` and `/stop`. Omni queues a steer that arrives after the run finished as the next run |
| Attachments | Described in the message. The files stay on the Mac; Hermes cannot read those paths |
| Usage | Token counts on the run, not the plan meter. It bills the Anthropic API, not the Claude, ChatGPT or Cursor plan |
| Availability | `GET /v1/capabilities` with the bearer token. A missing key or an unreachable URL shows on its agent's Server card |

### Servers you connect

Any other AI service on a server of your own, such as a second Hermes or one you built, joins the same way when it serves the [Runs API](../internals/remote-harness-protocol.md) Omni speaks to Hermes, or when it is an [eve agent](#eve-agents) such as Nomos. Each server is one file, `data/harnesses/<slug>.yaml`, and its threads run as harness `custom:<slug>`. **Add remote agent** in Settings > Agents writes the file and makes the agent ([Add remote agent](crew.md#add-remote-agent)).

### eve agents

An eve agent is an AI service built on Vercel's [eve](https://eve.dev) framework, such as Nomos. Omni talks to its own API (`/eve/v1`, the one eve's web chat and terminal use), so the agent needs no Runs API, and Omni needs no Vercel connector or Vercel API. Its file says `kind: eve`.

- **Signing in.** eve has no built-in key: each agent decides who may call it. To connect with one sign-in step, the agent serves Omni's pairing route and a Connect Omni page that shows a one-time code to whoever is signed in to its own web chat ([protocol](../internals/remote-harness-protocol.md#eve-agents)). The key Omni gets acts as that signed-in owner, so a thread reaches the same connections (Notion, say) the web chat does. An agent without the route connects with a key from Secrets that its route auth takes as a bearer token.
- **On Vercel**, turn Vercel Authentication off for the production deployment (project Settings > Deployment Protection), or nothing outside Vercel reaches the agent. The agent's own sign-in guards it then, so check it refuses strangers first. Find says so when it meets the wall.
- **Remove** revokes the key at the agent. Nomos stops taking it within 30 seconds.

| Piece | What |
| --- | --- |
| Session | One eve session per thread. Omni keeps eve's session id as the thread's (`omni-eve-<id>`), so later turns and a restart continue it. A session eve ended (after 30 days, say) is replaced by a new one, without the earlier context |
| Prompt | Omni's prompt goes as client context on the session's first message |
| Mid-turn messages | Wait for the turn to end and go as the next one: eve's steer would cancel the running turn and start again |
| Stop | Cancels the turn |
| In the thread | Reply text, a row per tool call and subagent, token counts and the model, from eve's event stream |
| Approvals and sign-ins | The thread shows a status line saying what the agent is waiting for. Answer it in the agent's own chat: Omni cannot answer yet |
| Reading the thread's files | Its own `omni_worktree` tool parks the turn with an input request, and Omni answers it ([protocol](../internals/remote-harness-protocol.md#eve-agents)) |
| Attachments | Described in the message, not sent |

Nomos's own setup: the Connect Omni page is `/omni`, behind its web login, and a deployment refuses to open its chat until `NOMOS_WEB_PASSWORD` is set.

### The harness file

You can still write the file by hand, or `POST /api/harnesses/custom/<slug>` with `{ name, kind?, url, secret, bills?, family?, cap?, capabilities? }` (`PUT` to change it, `DELETE` to remove it). `kind` is `runs-api` (the default) or `eve`.

```yaml
name: Hermes on Hetzner
kind: runs-api
url: https://hermes.tail1234.ts.net:8642
auth:
  scheme: bearer
  secret: HERMES_HETZNER_KEY   # the key itself goes in Settings > Secrets
bills: Anthropic API key on the VPS
family: anthropic
cap: 4
capabilities:
  steer: false                 # turn off what the server does not do; nothing turns on
```

- **The key** is the secret the file names, set in Settings > Secrets on each machine. The file syncs to your other machines; the key does not, and a machine without it shows the harness as not ready, naming the secret. The key goes only on that server's requests, never into a thread's environment. A file cannot name one of Omni's own credentials or any `OMNI_` name.
- **The URL** is `https://`, or plain `http://` only to this machine or a Tailscale address. Omni never follows a redirect.
- **Its agent binds to it by id**: `harness: custom:hermes-hetzner` with `model: default`, in a file of your own in `data/crew/`. Only a new agent's file names its server: an edit cannot bind an agent to a server or take it off one. A file written by hand with no agent gets one with its name at the next start. The Conductor sees the agent in `list_crew`, marked `remote`, and never the harness. Auto never picks it.
- **What it runs like**: a Hermes thread (an eve agent differs where [eve agents](#eve-agents) says). No browser, Omni tools, channel secrets or plan meter; Omni's prompt goes as `instructions`; a local agent, the Conductor included, never runs on its server, and it cannot run below Full access. Its replies come from a server outside Omni.
- **Only you** add, change or remove one: an agent thread, a Google or Omni Connect session and an app paired by code get a 403. It takes the install token or a browser paired with it.
- **Removing one** (Remove on its agent's Server card) keeps its threads readable. They do not run again, on it or on any other harness, until a server with that id is back.

## Cursor Cloud

A Cursor Cloud thread is a [Cursor cloud agent](https://cursor.com/docs/cloud-agent). It runs on Cursor's own Linux machines, on a fresh clone of the channel's GitHub repo, pushes a branch and opens a PR. The `cursor` harness is something else: it runs `cursor-agent` on your Mac. Ask the Conductor for a "Cursor cloud agent" and it picks Cursor Cloud; Auto never does.

It needs two things, and the model picker says which is missing:

- The secret `CURSOR_API_KEY`, globally or on the channel, made at cursor.com/dashboard under Integrations. A key only in the secret store (service `omni-os`, account `global/CURSOR_API_KEY`) works too. Omni sends it only to the Cloud Agents API, on the Authorization header. It never goes to the local `cursor` harness (`apps/server/harness/env-guard.ts` strips it there) and never into a process environment or a log.
- The channel's GitHub repo, which Omni reads from the channel's repo path (when it cannot, type it under Advanced in the channel's settings). Cursor also needs access to that repo through its GitHub integration.

| Piece | What |
| --- | --- |
| Start | The first message creates the agent (`POST /v1/agents`) with Omni's context and your brief, on the repo's default branch, with Cursor opening the PR when the run ends. The agent id is `bc-<thread id>`, which is also the thread's session |
| Follow-ups | Each later message is a new run on the same agent (`POST /v1/agents/{id}/runs`), on the same branch. A message sent mid-run waits for the run to end, because cloud agents can't steer here |
| In the thread | A card per run with its status, the agent on cursor.com, the branch it pushed and the PR. It updates every 10 seconds (`OMNI_CURSOR_CLOUD_POLL_MS`) |
| Reply | The agent's final message, with a line linking the agent and the PR. A delegated thread sends it to the Conductor as its crew report |
| Stop | Cancels the run. Quitting Omni does not cancel it. The agent keeps working, and the next message waits for it before it goes |
| Attachments | Images (PNG, JPEG, GIF, WebP, up to five, 15 MB each) go with the prompt. Other files stay on the Mac and the message describes them |
| Models | Cursor default (the one set on cursor.com) or a model from Cursor's list. No effort levels |
| Usage | Billed to your Cursor plan. Omni shows no meter for it |

Because the agent runs on a Cursor machine, it cannot build the desktop app for the Mac, run the desktop app, or take screenshots of it or a browser. Its prompt tells it to say what it could not check. Pull the branch and do those on your own machine.

Omni drives the [Cloud Agents API v1](https://cursor.com/docs/cloud-agent/api/endpoints), which Cursor marks as a public beta.

