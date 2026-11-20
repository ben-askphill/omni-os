# Harnesses

A harness is the AI CLI a thread runs on. Pick one per channel (its default) or per thread in the model picker, or leave it to [Auto](#auto). Each runs through its official CLI and bills the plan it is signed in to. Hermes, Cursor Cloud and [custom harnesses](#custom-harnesses) are the exceptions. They run off the Mac and Omni talks to them over HTTP. [Accounts](#accounts) shows which account each one is signed in to on each machine.

| Harness | Bills | Install and sign in | Runs as |
| --- | --- | --- | --- |
| Claude Code | Claude plan | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` | `claude -p` with stream-json |
| Codex | ChatGPT plan | `npm install -g @openai/codex && codex login` | `codex app-server` ([ADR 0001](../adr/0001-codex-app-server.md)) |
| Cursor Agent | Cursor plan | `curl https://cursor.com/install -fsS \| bash && cursor-agent login` | `cursor-agent` |
| Hermes | Anthropic API | On your own Linux server, see [below](#hermes-remote) | HTTP over Tailscale ([ADR 0003](../adr/0003-hermes-remote-harness.md)) |
| Cursor Cloud | Cursor plan | Secret `CURSOR_API_KEY`, see [below](#cursor-cloud) | A Cursor cloud agent, through the Cloud Agents API |
| Custom harness | What its server bills | A file in `data/harnesses/`, see [below](#custom-harnesses) | HTTP, the [Runs API](../internals/remote-harness-protocol.md) ([ADR 0017](../adr/0017-custom-harnesses.md)), or an [eve agent's own API](#eve-agents) ([ADR 0018](../adr/0018-eve-agents.md)) |

- `OMNI_CLAUDE_BIN`, `OMNI_CODEX_BIN` and `OMNI_CURSOR_BIN` in `.env` point at a binary that is not on `PATH`. Without one, Codex also tries the copy inside the ChatGPT app.
- A harness Omni can't use shows why in the model picker, Settings > Models and the error `delegate` gets. Claude Code is asked with `claude auth status --json`: signed out reads as `claude auth login`, no `claude` on `PATH` as missing, and a CLI too old to answer stays available. For Codex that is one of: signed out (`codex login`), signed in with an API key, no `codex` on `PATH`, a binary that won't run, `codex app-server` exiting before it answers (with the last line it printed), or no answer to a request. A server busy with disk writes does not count as no answer.
- The Usage card (desktop web and the desktop app; phone and iOS have none) has a row per signed-in account, and each limit says when it resets ("in 2h 10m"; hover or tap for the local time). Claude's rate-limit events drive the 5h and week windows, Codex reports its own, and Cursor's dashboard gives the monthly cycle. Hermes and Cursor Cloud have no plan limit to show. A window whose source sent no reset time shows no reset. An account with no reading of its own yet says **no reading yet** (and never borrows another account's numbers); a stale or missing reading on a lone account still says **no data**.
- Each harness has its own concurrency cap (12 by default): `OMNI_MAX_CONCURRENT` (Claude Code), `OMNI_MAX_CONCURRENT_CODEX`, `OMNI_MAX_CONCURRENT_CURSOR`, `OMNI_MAX_CONCURRENT_HERMES`, `OMNI_MAX_CONCURRENT_CURSOR_CLOUD`. A full harness never holds up threads on another.
- Each harness drops variables that would move it off the signed-in plan or away from the login Omni expects (`apps/server/harness/env-guard.ts`). Claude Code drops `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `CLAUDE_CONFIG_DIR` (so traffic and transcripts stay on `~/.claude`). Codex drops `OPENAI_API_KEY`, `CODEX_API_KEY` and `OPENAI_BASE_URL`. Cursor and Cursor Cloud drop `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`. Every harness drops `HERMES_API_KEY`, and no harness, terminal or channel action gets a custom harness's key (a secret its file names): those keys go only to their harness's HTTP client. The guard wins over the server environment, a channel or global secret, and any extras, so a secret with one of those names never reaches that harness. A thread's terminal drops the union of every harness list. A login shell profile still runs, so a value exported there can come back.
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

The model and effort pickers in a thread's reply box move it to another model, effort or harness. Switching does not work to or from Hermes, Cursor Cloud or a custom harness, which have no worktree on this Mac. A Cursor Cloud thread keeps the model its agent started with.

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
- Hermes, Cursor Cloud and custom harnesses can't take a continued thread, and a thread running on them can't be continued, since their files are not on this Mac.
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
- Composer only runs while Cursor's Auto and Composer usage is under 90%. Auto never picks Grok, Gemini or Cursor's other named models, Hermes or Cursor Cloud. [Auto routing](../internals/auto-routing.md#lanes) explains why.
- A model picked on the thread, an agent's or a channel's default all win over Auto. Set a channel's default to Auto in its settings, or `model: auto` in an agent's frontmatter.
- In #conductor, a saved channel default takes precedence over the Conductor agent's charter. New thread follows saved settings until you pick a model or effort for that draft. Other agents keep their own defaults ahead of the channel's.
- How well it picks, and how to check that again: [Auto routing](../internals/auto-routing.md).

## Hermes (remote)

Hermes is an always-on AI service on your own Linux server. Omni does not spawn it. The Hermes API server listens on the server's Tailscale address and is not public. A thread talks to it at `OMNI_HERMES_URL`, the server's Tailscale address and port (set it in Settings or `npm run setup`; empty means Hermes is off). The Mac must be on the tailnet.

The bearer token is the global secret `HERMES_API_KEY` (or a channel secret of that name). It is not an env var or a database column, Omni never writes it to logs, and no local thread, terminal or channel action gets it.

| Piece | What |
| --- | --- |
| Where it runs | On the Hermes server, in whatever clone Hermes already has. Omni does not create a worktree, browser profile or artifacts dir for the thread |
| Session | `omni-<thread id>`. The same id continues the conversation, with Hermes' own context |
| Prompt | Channel facts (repo, store, notes) go in `instructions` on the first run. The transcript shows only what you typed |
| Steer / interrupt | `POST /v1/runs/{id}/steer` and `/stop`. Omni queues a steer that arrives after the run finished as the next run |
| Attachments | Described in the message. The files stay on the Mac; Hermes cannot read those paths |
| Usage | Token counts on the run, not the plan meter. It bills the Anthropic API, not the Claude, ChatGPT or Cursor plan |
| Availability | `GET /v1/capabilities` with the bearer token. A missing key or an unreachable URL shows the fix in the model picker |

## Custom harnesses

A custom harness is another AI service on a server of your own, such as a second Hermes or one you built, that serves the [Runs API](../internals/remote-harness-protocol.md) Omni speaks to Hermes, or an [eve agent](#eve-agents) such as Nomos. Each is one file, `data/harnesses/<slug>.yaml`, and runs as harness `custom:<slug>`. Settings > Models > Harnesses lists each one with a Remote mark, its host and the secret its key is in, and Test connection, Edit and Remove under it.

### Connect a harness

**Connect a harness** on the Harnesses card (and on the Harnesses step of setup) adds one without pasting its key. The same sheet runs on desktop web, the phone layout and the desktop app.

1. **On a Hermes server**, run the pairing helper the sheet shows, pinned to this build: `curl -fsSL https://raw.githubusercontent.com/ben-askphill/omni-os/<release tag>/scripts/omni-pair.sh | sh`. It prints an `omni://connect-agent` link, a QR code when `qrencode` is installed, and an address and code to type. It makes `API_SERVER_KEY` in Hermes's `.env` when there is none (restart Hermes after), and answers one pairing for at most 10 minutes. **For an eve agent** there is nothing to run: go straight to Find with its address.
2. **Find.** Click the link (the desktop app opens it), or paste it, a bare address, or the helper's address and code into the sheet. Omni looks at the address without a key and shows what it found: its name and host, what kind of agent it is, whether it is on this machine, the tailnet or https, and chips for what a thread on it can and cannot do. Plain `http://` off the tailnet, an address this machine cannot reach, a Vercel deployment behind Vercel's login wall, and A2A agents (a later version) say why they cannot connect.
3. **Sign in.** With a code, **Pair** redeems it server to server: the key goes into this machine's server and never reaches the page. An eve agent that pairs shows **Get a code**, which opens its own Connect Omni page in a new tab or your browser: sign in there if it asks, copy the code, paste it in the sheet and press Pair. Without pairing, pick the secret in Secrets that holds the key, or add it there from the sheet.
4. **Test.** One short turn on its own session ("Reply with one line: your name and the model you run on"), with the reply, the model, the time it took and its tokens, or which step failed and what came back.
5. **Connect** saves only after the test passed: a paired key as the global secret `AGENT_<SLUG>_KEY`, the harness file, and with **Make an agent for it** (on by default) an agent of the same id bound to it, delegatable and with no powers. A failure at any step undoes the steps before it.

A link never reaches out to anything by itself: it fills the sheet in, you press Find to look the harness up, and Connect once its test turn passed. `#/settings/models?connect=<link>` opens the same sheet on a phone or in a browser. **Remove** revokes the key at the agent when it offers that, deletes the secret Connect made for it (a secret you picked yourself stays), and deletes the file here and on your other machines. Editing its address or secret first makes Remove skip the revoke and leave every secret alone, since the paired key may not be the one the file names any more. Hermes gives every machine the same key, so to cut one machine off, change `API_SERVER_KEY` on the server. Agent threads cannot connect, change, test or remove one (403); the Conductor hands you the page instead.

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
- **An agent binds to it by id**: `harness: custom:hermes-hetzner` with `model: default`. The Conductor sees it in `list_harnesses`. Auto never picks it.
- **What it runs like**: a Hermes thread (an eve agent differs where [eve agents](#eve-agents) says). No worktree, browser, Omni tools, channel secrets or plan meter; Omni's prompt goes as `instructions`; it cannot run the Conductor or any delegate-only agent, or run below Full access. Its replies come from a server outside Omni.
- **Only you** add, change or remove one: an agent thread, a Google or Omni Connect session and an app paired by code get a 403. It takes the install token or a browser paired with it.
- **Removing one** keeps its threads readable. They do not run again, on it or on any other harness, until a harness with that id is back.

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

