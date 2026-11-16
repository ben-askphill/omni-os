# Automations

`automations/*.yaml` are shared examples (`morning-coffee`, `weekly-review`, `artifact-comments`, `brain-nightly`, `pr-babysitter`, `fix-failing-checks`, `tool-failure-triage`, `docs-daily`), all off until you turn them on. Your own automations go in `data/automations/`; the same id there wins over the shared one.

## Edit in Omni

The Automations page edits every field of an automation and writes the result into its YAML. New makes one, Edit on a card opens it, and the toggle turns it on or off. Desktop web, phone web and the desktop app share the editor.

- The Form tab covers name, on or off, a schedule (cron, timezone, catch-up) or an event with its options, channel, machine, role, harness, model, effort and prompt. The YAML tab edits the file as text.
- Every save, the toggle included, writes `data/automations/<id>.yaml`. Editing a shared one writes your own copy there first, with the file's comments and any keys the form does not know kept. Its card then says Edited, and updates to the shared file stop reaching it until Reset to shipped in the editor drops your copy.
- Omni refuses a save it would load as invalid (a bad cron, both `cron` and `on`, an unknown channel, harness or model), and writes nothing.
- With sync on, a file saved in Omni reaches your other machines too, and so does a Delete of it. A file you edit by hand, or saved in Omni before sync was set up, stays on its machine until its next save in Omni with sync on.
- An old per-machine on/off or channel override in `data/omni.config.json` (`automations.<id>.enabled`, `.channel`) is folded into the file on its first save and removed.
- The Conductor has the same: `list_automations` lists each one with where it runs, `get_automation` reads its file and fields, `save_automation` creates or changes one, `set_automation_enabled` turns it on or off in its YAML, `run_automation` starts one now on this machine and `delete_automation` deletes like the card does.

Delete on an automation's card removes it from this machine after a confirmation. One of your own in `data/automations/` loses its YAML file. A shared one stays in `automations/`, Omni hides it with `automations.<id>.deleted` in `data/omni.config.json`, so an update cannot bring it back, and removing that key restores it. Either way its schedule stops at once, a webhook automation's signing secret goes with it, and threads it already started stay. Hiding a shared one is per machine. With sync on, delete it on the machine that runs it too. Desktop web, phone web and the desktop app all have Delete. The native iOS Automations screen can only toggle, which writes the YAML the same way.

```yaml
name: Morning coffee
enabled: false          # the default; the UI toggle writes it here
cron: "0 8 * * 1-5"
timezone: Europe/Amsterdam  # optional, defaults to your timezone
channel: inbox          # default inbox
role: inbox
harness: claude         # optional, like model and effort
model: sonnet
machine: omarchy        # optional: the synced machine that runs it, by name or sync id
prompt: |
  Run the morning-coffee skill for today.
```

`timezone` defaults to your timezone from the config (`OMNI_TZ` wins, else the system's). Omni watches both folders, so edits apply without a restart. The Mac has to be awake at the scheduled time, unless the automation sets `catchup: true`. Then a missed slot runs once Omni is back.

## Scan my usage

Scan my usage on the Automations page suggests automations from your own history. Desktop web, phone web and the desktop app all have it; the Conductor starts one with `scan_usage` when you ask.

1. Omni reads the first message you typed in each thread you started in the last 90 days, plus the slash commands you used. It leaves out threads an automation started and every thread below one or continued from one, threads the Conductor, a team lead or another agent started and every thread below or continued from those (their first message is a brief an agent wrote), earlier scans, forks of the same ask, and channels set to **Leave out of usage scans** (Channel settings, Advanced; iOS Channel Settings too). Pick one channel in the dialog to scan only that.
2. It groups asks that share a slash command, a linked site (GitHub PRs, Shopify admin, claude.ai pages) or a phrase: 6 or more asks over 3 or more weeks. No model runs for this.
3. Secrets are masked before any text goes further or is grouped: token patterns in any case, and the values in Omni's secret store in any case, URL-encoded, form-encoded, in base64 and JSON-escaped. A slash command that holds a secret is dropped. A value only part of which appears (cut off, or quoted in a thread title a model wrote) is not caught. Haiku labels each group on this machine through your Claude Code login, as it does thread titles.
4. A thread in #Inbox with the usage-scan role (`crew/usage-scan.md`) gets the groups, a few masked examples each, when they usually come in and the automations you already have. It replies with the patterns and up to 3 suggestions, each split 10/90: the small safe part a run does on its own, and the rest, where the run stops and explains the problem for you. It does not read transcripts.
5. Nothing is created until you answer in that thread. It then saves only the ones you picked, with `save_automation`, and every one starts off. Turn each on here when you are happy with it.

Omni holds the lead to this: until you have replied in the thread, or answered a question it asked, a save from it is refused, and whatever it saves is written with `enabled: false`. It cannot change, turn on, run or delete an existing automation. A scan that finds nothing repeating says so and starts no thread.

To see the groups without any model, run the same query read-only against a database:

```sh
npm run repeated-asks --workspace @omni/server -- --db data/omni.db [--channel <id>] [--samples] [--json]
```

## Safety

- **Turned off after 3 failed runs in a row.** When a run thread of an automation fails for the third time in a row, Omni turns the automation off in its YAML, like the toggle (so it syncs), and adds a Turned off row to its run history with the reason. Its card says Turned off after 3 failed runs. A finished run breaks the streak; skipped and stopped runs neither count nor break it. Turning it back on starts the count again. Any number of skipped runs between two failures does not hide the earlier one. Only the machine that runs the automation turns it off, and it also counts runs another machine started once their history syncs over.
- **Automation threads cannot make automations.** A thread an automation started, and every thread below it at any depth (a crewmate it delegated to, a team, a thread continued from one of them), cannot create, change, turn on or run automations, retry a delivery, or start a usage scan. It can still turn one off or delete one. Omni's MCP servers name the calling thread on every request (`x-omni-thread`), and the API refuses with 403. A command a thread runs itself against the API names no thread and is not checked.

## Skipping runs with nothing to do

Two optional fields keep a scheduled automation from spending plan usage on a run it does not need:

```yaml
precheck:
  command: gh pr list --author @me --json number --jq 'length > 0' | grep -q true
  timeout: 30           # seconds, default 30, at most 600
catchup: true
catchup_max_age: 6h     # seconds, or 45s, 90m, 6h, 2d
```

- `precheck` is a shell command (a plain string works too) run in the channel's folder through your login shell, before any thread or harness starts. Exit 0 runs the automation. A non-zero exit, a timeout or a shell that cannot start skips the run. `{{omniRoot}}` and the other prompt placeholders work in it.
- It runs for scheduled runs only: cron ticks and catch-ups. Run now and event runs ignore it.
- `catchup_max_age` caps a catch-up: when the missed slot is older than this, Omni skips it instead of starting a stale run after the Mac wakes. A missed slot within the age still runs once.
- A skipped run makes no thread and nothing in the Inbox. It shows in the automation's run history as Skipped with its reason (the precheck's exit code and last line of stderr, the timeout, or the missed slot's time) on desktop web, phone web, the desktop app and iOS, and it counts as that slot's run, so a catch-up does not try it again.

`pr-babysitter` skips when you have no open PR on the repo, and `docs-daily` skips when `scripts/docs-daily.sh preflight` finds nothing that needs docs.

## Choose a machine

In Automations, "Run automations on" picks this machine or another synced machine for every scheduled and event-triggered automation that does not name its own. The choice reaches the other machines through sync.

One automation can pick its own under Edit, Machine. That writes `machine:` into its YAML, by the machine's name (its sync id when two machines share a name), and the file syncs, so every machine agrees on where it runs. Same as Run automations on removes the key. A `machine:` that names no synced machine runs nowhere until that machine syncs, and its card shows the name with a warning. Without sync every automation runs here and the picker is off.

The chosen machine needs the channel folders and credentials the automation uses, and must be awake with Omni running. Offline machines can be picked for future runs. This does not move a running thread. "Run now" runs on the connected machine. The card's machine chip says where each one runs.

The Conductor makes the shared choice with `set_automations_machine`, and one automation's with `save_automation` (`fields.machine`), using an id or name from `list_devices`, or `here`.

## Tool-failure triage

`tool-failure-triage` reviews the tool-failure log (`GET /api/tool-failures`) at 08:30 on weekdays in the `omni-os` channel as a builder:

- It reads only occurrences newer than the `Reviewed through <time>` that starts each group's guidance, and skips its own thread.
- The run investigates a group once it has 3 or more occurrences or spans 2 or more threads, or when one occurrence is plainly an Omni bug. The run reads each failed call's context from its thread's events and never copies arguments or output anywhere.
- Expected noise (a grep with no match, a probe, a test failing mid-fix) goes into the group's guidance. Its status is left as it was, because one group can mix noise and real causes.
- The run fixes recurring causes in Omni or in your workspace folder's repo (its skills, rules and CLAUDE.md) in one PR per repo, labelled `tool-failure-triage`. While one is open, later runs push to it. It merges nothing.
- Groups a PR addresses become `investigating` with `owner/repo#N` in their guidance (guidance drops links). A later run marks them `fixed` once the PR is merged.
- It never sets `avoid` or `replacement` and never disables a tool. It proposes those in its reply instead.

The log is local to each Mac, and with sync on, scheduled runs fire only on the Mac that owns automations. That is the Mac whose failures get reviewed.

## Docs daily

`docs-daily` runs at 16:00 Europe/Amsterdam every day in the `omni-os` channel as a builder. It uses `scripts/docs-daily.sh` to fetch `ben-askphill/omni-os`, compare `origin/main` to the last processed SHA in `data/docs-daily/last-sha`, and exit when only documentation changed. Otherwise it updates docs in a scratch worktree, opens a `docs/auto-YYYY-MM-DD` PR, squash-merges it once its checks pass (or at once when it has none), leaves it open when a check fails, and records the new SHA. The script aborts before merging if the diff is not docs-only. Its log is `data/logs/docs-daily.log`. Scheduled runs use the Mac that owns automations, and `catchup: true` runs a missed slot once Omni is back.

## Event automations

Replace `cron` with `on` and the automation runs when something happens instead of on a schedule: a change on a PR, a page a thread published, or a signed GitHub webhook.

### PR events

```yaml
name: Fix failing PR checks
enabled: false
on: pr_checks_failed    # or { event: pr_checks_failed, repo: owner/name, drafts: true, trust: any }
channel: omni-os        # without on.repo, the channel's GitHub repo is watched
role: builder
prompt: |
  A PR's checks failed. Fix the cause on its branch, verify, push.
```

| Event | Fires |
| --- | --- |
| `pr_opened` | once per new open PR |
| `pr_checks_failed` | once per head commit whose checks fail (a workflow waiting for approval, `ACTION_REQUIRED`, does not count) |
| `pr_conflict` | once per head commit that conflicts with its base |
| `pr_review` | when reviews or comments arrive from a trusted author other than the `gh` account Omni uses (a bare approval does not count) |

- Omni polls `gh pr list` every `OMNI_AUTOMATION_POLL_SECONDS` (default 120, minimum 15), one call per repo however many automations watch it. Because it polls, it works even when GitHub cannot reach the server. [GitHub webhooks](#github-webhooks) need a route from GitHub to it.
- The first poll after an automation is turned on only records what is open, so it never fires for old failures.
- Each run's prompt is the automation's prompt plus an `## Event` section (repo, PR number and title, what happened, branch and URL). Its title is `<name> · #<PR>`, and its trigger is `event` in the run list.
- What each automation has seen lives in kv `automations.events.<id>`, so a restart does not fire again. With sync on, only the Mac that runs scheduled automations polls.
- Drafts are skipped unless `drafts: true`. Run now still works and sends the plain prompt.
- Only trusted authors fire an event. A PR, review or comment counts when its author is an `OWNER`, `MEMBER` or `COLLABORATOR` of the repo, and a PR from a fork never counts. A run checks out the PR and runs its code with your secrets and `gh` login, so on a public repo anyone could otherwise run code on your Mac by opening a PR. `trust: any` turns this off for that automation. Only set it on a repo where you trust everyone who can open a PR.
- The PR's title, branch and the event line reach the run inside a code fence, as data.

### Published pages

`on: artifact_published` runs the automation when a thread publishes a page to claude.ai with its Artifact tool (Claude Code threads; the other harnesses have no Artifact tool):

```yaml
name: Review published pages
enabled: false
on: { event: artifact_published, channels: [omni-os] }  # or just `on: artifact_published` for any channel
channel: omni-os
role: builder
prompt: |
  Review the page that was just published and list what to fix.
```

- `channels` limits it to publishes from threads in those channels. `updates: true` fires on a republish to a page's existing URL too. By default only a page's first publish counts.
- Omni saves each matching publish as a delivery before it makes any thread, keyed by the automation and the publish (the thread and its tool call). Seeing the same tool result again, a restart, or both Macs seeing it never starts a second run. If Omni restarts before it makes the run, it starts the run once it is back.
- A publish from one of the automation's own runs, from a thread under one, or from a run whose page started it is skipped, so two automations cannot start each other forever.
- The run's prompt is the automation's prompt plus an `## Event` section with the page's URL, and its title, file, description and the thread and channel that published it, in a code fence, as data. Its title is `<name> · <page>`, and its trigger is `event`.
- The Automations page lists the last deliveries with their outcome: Started (with a link to the run), Held for owner, Failed or Skipped, with the reason. [Deliveries](#deliveries-history-retry-and-skip) says what you can do with one.
- With sync on, only the machine that runs the automation (its own `machine:`, else Run automations on) starts a run. The other Mac holds each delivery for it, whatever its own toggle says, and sync carries it over. That Mac skips it if the automation is paused there or it has no automation with that id. A file in `data/automations/` that you only edited by hand exists on its Mac alone, so a publish on the other Mac does not reach it. A save in Omni syncs it.

### GitHub webhooks

`on: { event: github_webhook, repo: owner/name }` runs the automation when GitHub posts a signed `workflow_run` or `pull_request_review` event to it:

```yaml
name: Fix failed CI
enabled: false
on: { event: github_webhook, repo: acme/shop, events: [workflow_run] }  # events: both by default
channel: acme
role: builder
prompt: |
  A workflow run finished. If it failed, find the cause on its branch, fix it, verify, push.
```

- Each webhook automation has its own endpoint, `POST /api/hooks/github/<id>`, shown on its card. Set it as the hook's Payload URL on GitHub with content type `application/json`, and choose the events the automation takes.
- The signing secret lives in the server's secret store as `OMNI_WEBHOOK_<ID>`. Set it with Set secret on the automation's card, and paste the same value into the hook's Secret on GitHub. The clients only show whether it is set. It never reaches a thread. Each Mac that receives the hook needs its own copy.
- That route takes no API token. A request proves itself with its `X-Hub-Signature-256` instead. Omni refuses a body over 1 MB, a content type other than `application/json`, an event the automation does not take, a missing `X-GitHub-Delivery`, a bad signature or another repo before it saves anything. Without a secret on this Mac the route answers 503. GitHub's `ping` gets a 200 and saves nothing.
- Only finished workflow runs (`completed`) and submitted reviews count; other actions get a 202 and save nothing. Omni saves runs for fork PRs and reviews from outside the repo's owners, members and collaborators as Skipped unless `trust: any`. Reviews by the `gh` account Omni uses are always skipped, so a run that reviews cannot start the next.
- Omni saves a valid event as a delivery, keyed by the automation and its `X-GitHub-Delivery` id, before it replies (202). GitHub redelivering it, to either Mac, gets the same delivery back (200, `duplicate: true`) and starts nothing more. On a paused automation the Mac that runs automations answers 409 and saves nothing.
- The run's prompt is the automation's prompt plus an `## Event` section with what GitHub sent (workflow, conclusion, branch, commit, run URL; or PR, reviewer, state and up to 1,000 characters of the review), each field cut short, in a code fence, as data. Its title is `<name> · <commit or PR title>`, and its trigger is `event`.
- Deliveries, sync and the other Mac work as for published pages. The Mac that receives the request saves it, and only the Mac that runs automations starts the run.
- Omni does not expose the endpoint to the internet. GitHub reaches it only if you route it there yourself. A signed request from your own network works without that.

### Deliveries: history, retry and skip

Both event triggers save every event as a delivery, and the card for an event automation lists them: the latest five, then Show older for the rest. Open a delivery to see how far it got in three steps.

- **Trigger.** Received, Accepted, Held for owner (saved on the other Mac, waiting for the one that runs automations) or Skipped, with the reason.
- **Run.** Whether its thread was made. Waiting to start (with why), Thread created (with the error, if Omni hit one afterwards), Could not start, or Never started.
- **Execution.** What the thread did, its own status: Running, Finished, Failed or Stopped. A run that failed is still a created run. Its delivery says Started, and the thread has the failure.

The detail also shows when the event arrived, which attempt this is, when it expires, and the fields that came with the event. It never shows a signature, a header or the raw request. A delivery that has a thread links to it.

What you can do:

- **Retry** goes again for a delivery that failed before any thread was made, for example because the channel was gone and you have fixed it. It runs as the next attempt, with a thread of its own, and starts at once, on the Mac that runs automations. Clicking twice makes one attempt.
- **Skip** is final. The event never starts, here or on the other Mac, and cannot be retried. It works on a delivery that has not started, including a failed one. If the run is already being made when you skip, the skip is refused and the run goes ahead. With sync on, only the Mac that runs automations skips an event that has not started, because the other Mac cannot tell whether it is starting this moment. That Mac's card says so.
- **A run that was made is never retried.** If Omni errors after it made the thread, the delivery shows Started with the error, linked to the thread. What the run did is unknown, so open the thread and send a follow-up there. Failed always means no thread was made.

Limits, set in the `on:` block of a published-page or webhook automation:

```yaml
on: { event: github_webhook, repo: acme/shop, max_age: 2h, concurrency: 1 }
```

- `max_age` (`90s`, `15m`, `6h`, `2d`; a day by default) skips an event that is older than this when its turn comes. It counts from when the event arrived, so an hour of Omni being off, or the other Mac asleep on a held event, does not revive it. A skipped event stays skipped after a restart or when the automations move to the other Mac. A retry of an event past its age is refused.
- `concurrency` (1 to 8; 2 by default) is how many of the automation's runs may be going at once. The rest of a burst waits as Accepted and starts as runs end, so a hundred events cannot queue ahead of your own messages.
- After a start fails, the automation's other new events wait 30 seconds, then 1 minute, doubling to 15 minutes, until a start works. A retry you ask for is not held by that wait.

The Conductor has the same three actions: `list_automation_deliveries`, `retry_delivery` and `skip_delivery`.
