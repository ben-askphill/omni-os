# Automations

`automations/*.yaml` are shared examples (`morning-coffee`, `weekly-review`, `artifact-comments`, `brain-nightly`, `pr-babysitter`, `fix-failing-checks`, `tool-failure-triage`, `docs-daily`), all off until you turn them on. Turning one on or off in the UI writes `automations.<id>.enabled` to `data/omni.config.json`, never the YAML, and `automations.<id>.channel` there moves it to another channel. Your own automations go in `data/automations/`.

```yaml
name: Morning coffee
enabled: false          # the default; the UI toggle overrides it per machine
cron: "0 8 * * 1-5"
timezone: Europe/Amsterdam  # optional, defaults to your timezone
channel: inbox          # default inbox
role: inbox
harness: claude         # optional, like model and effort
model: sonnet
prompt: |
  Run the morning-coffee skill for today.
```

`timezone` defaults to your timezone from the config (`OMNI_TZ` wins, else the system's). Both folders are watched; edits apply without a restart. The Mac has to be awake at the scheduled time, unless the automation sets `catchup: true`: then a missed slot runs once Omni is back.

## Choose a machine

In Automations, use "Run automations on" to choose this machine or another synced machine. The choice applies to all scheduled and event-triggered automations and reaches the other machines through sync. The selected machine needs the automation definitions, channel folders and credentials it uses, and must be awake with Omni running. Offline machines can be selected for future runs. This does not move a running thread. "Run now" runs on the connected machine.

The Conductor can make the same choice with `set_automations_machine`, using an id or name from `list_devices`, or `here`.

## Tool-failure triage

`tool-failure-triage` reviews the tool-failure log (`GET /api/tool-failures`) at 08:30 on weekdays in the `omni-os` channel as a builder:

- It reads only occurrences newer than the `Reviewed through <time>` that starts each group's guidance, and skips its own thread.
- A group is investigated once it has 3 or more occurrences or spans 2 or more threads, or when one occurrence is plainly an Omni bug. The run reads each failed call's context from its thread's events and never copies arguments or output anywhere.
- Expected noise (a grep with no match, a probe, a test failing mid-fix) goes into the group's guidance. Its status is left as it was, because one group can mix noise and real causes.
- Recurring causes in Omni or in your workspace folder's repo (its skills, rules and CLAUDE.md) are fixed in one PR per repo, labelled `tool-failure-triage`. While one is open, later runs push to it. Nothing is merged.
- Groups a PR addresses become `investigating` with `owner/repo#N` in their guidance (guidance drops links). A later run marks them `fixed` once the PR is merged.
- It never sets `avoid` or `replacement` and never disables a tool. It proposes those in its reply instead.

The log is local to each Mac, and with sync on scheduled runs fire only on the Mac that owns automations, so that is the Mac whose failures get reviewed.

## Docs daily

`docs-daily` runs at 16:00 Europe/Amsterdam every day in the `omni-os` channel as a builder. It uses `scripts/docs-daily.sh` to fetch `ben-askphill/omni-os`, compare `origin/main` to the last processed SHA in `data/docs-daily/last-sha`, and exit when only documentation changed. Otherwise it updates docs in a scratch worktree, opens a `docs/auto-YYYY-MM-DD` PR, squash-merges when checks pass, and records the new SHA. The script aborts before merge if the diff is not docs-only; see `data/logs/docs-daily.log`. Scheduled runs use the Mac that owns automations; `catchup: true` runs a missed slot once Omni is back.

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

- Omni polls `gh pr list` every `OMNI_AUTOMATION_POLL_SECONDS` (default 120, 15 at least), one call per repo however many automations watch it. Polling, so it works while GitHub cannot reach the server; [GitHub webhooks](#github-webhooks) need a route from GitHub to it.
- The first poll after an automation is turned on only records what is open, so it never fires for old failures.
- Each run's prompt is the automation's prompt plus an `## Event` section (repo, PR number and title, what happened, branch and URL). Its title is `<name> · #<PR>`, and its trigger is `event` in the run list.
- What each automation has seen lives in kv `automations.events.<id>`, so a restart does not fire again. With sync on, only the Mac that runs scheduled automations polls.
- Drafts are skipped unless `drafts: true`. Run now still works and sends the plain prompt.
- Only trusted authors fire: a PR, review or comment counts when its author is an `OWNER`, `MEMBER` or `COLLABORATOR` of the repo, and a PR from a fork never counts. A run checks out the PR and runs its code with your secrets and `gh` login, so on a public repo anyone could otherwise run code on your Mac by opening a PR. `trust: any` turns this off for that automation; only set it on a repo where you trust everyone who can open a PR.
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

- `channels` limits it to publishes from threads in those channels. `updates: true` fires on a republish to a page's existing URL too; by default only a page's first publish counts.
- Each publish that matches is saved as a delivery before any thread is made, keyed by the automation and the publish (the thread and its tool call). Seeing the same tool result again, a restart, or both Macs seeing it never starts a second run. A restart before the run was made starts it once Omni is back.
- A publish from one of the automation's own runs, from a thread under one, or from a run whose page started it is skipped, so two automations cannot start each other forever.
- The run's prompt is the automation's prompt plus an `## Event` section with the page's URL, and its title, file, description and the thread and channel that published it, in a code fence, as data. Its title is `<name> · <page>`, and its trigger is `event`.
- The Automations page lists the last deliveries with their outcome: Started (with a link to the run), Held for owner, Failed or Skipped, with the reason. [Deliveries](#deliveries-history-retry-and-skip) says what you can do with one.
- With sync on, only the Mac that runs automations starts a run. The other Mac holds each delivery for it, whatever its own toggle says, and sync carries it over; that Mac skips it if the automation is paused there or it has no automation with that id. Personal automations in `data/automations/` only exist on their Mac, so a publish on the other Mac does not reach them.

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

- Each webhook automation has its own endpoint, `POST /api/hooks/github/<id>`, shown on its card in both clients. Set it as the hook's Payload URL on GitHub with content type `application/json`, and choose the events the automation takes.
- The signing secret lives in the server's secret store as `OMNI_WEBHOOK_<ID>`. Set it with Set secret on the automation's card (Web UI or Mac app), and paste the same value into the hook's Secret on GitHub. The clients only show whether it is set. It never reaches a thread. Each Mac that receives the hook needs its own copy.
- That route takes no API token: a request proves itself with its `X-Hub-Signature-256`. A body over 1 MB, a content type other than `application/json`, an event the automation does not take, a missing `X-GitHub-Delivery`, a bad signature or another repo is refused before anything is saved. Without a secret on this Mac the route answers 503. GitHub's `ping` gets a 200 and saves nothing.
- Only finished workflow runs (`completed`) and submitted reviews count; other actions get a 202 and save nothing. Runs for fork PRs and reviews from outside the repo's owners, members and collaborators are saved as Skipped unless `trust: any`. Reviews by the `gh` account Omni uses are always skipped, so a run that reviews cannot start the next.
- A valid event is saved as a delivery, keyed by the automation and its `X-GitHub-Delivery` id, before Omni replies (202). GitHub redelivering it, to either Mac, gets the same delivery back (200, `duplicate: true`) and starts nothing more. On a paused automation the Mac that runs automations answers 409 and saves nothing.
- The run's prompt is the automation's prompt plus an `## Event` section with what GitHub sent (workflow, conclusion, branch, commit, run URL; or PR, reviewer, state and up to 1,000 characters of the review), each field cut short, in a code fence, as data. Its title is `<name> · <commit or PR title>`, and its trigger is `event`.
- Deliveries, sync and the other Mac work as for published pages: the Mac that receives the request saves it, and only the Mac that runs automations starts the run.
- Omni does not expose the endpoint to the internet. GitHub reaches it only if you route it there yourself; a signed request from your own network goes the whole way.

### Deliveries: history, retry and skip

Both event triggers save every event as a delivery, and the card for an event automation lists them: the latest five, then Show older for the rest. Open a delivery to see how far it got in three steps.

- **Trigger.** Received, Accepted, Held for owner (saved on the other Mac, waiting for the one that runs automations) or Skipped, with the reason.
- **Run.** Whether its thread was made. Waiting to start (with why), Thread created (with the error, if Omni hit one afterwards), Could not start, or Never started.
- **Execution.** What the thread did, its own status: Running, Finished, Failed or Stopped. A run that failed is still a created run. Its delivery says Started, and the thread has the failure.

The detail also shows when the event arrived, which attempt this is, when it expires, and the fields that came with the event. It never shows a signature, a header or the raw request. A delivery that has a thread links to it.

What you can do:

- **Retry** goes again for a delivery that failed before any thread was made, for example because the channel was gone and you have fixed it. It runs as the next attempt, with a thread of its own, and starts at once, on the Mac that runs automations. Clicking twice makes one attempt.
- **Skip** is final: the event never starts, here or on the other Mac, and cannot be retried. It works on a delivery that has not started, including a failed one. If the run is already being made when you skip, the skip is refused and the run goes ahead. With sync on, only the Mac that runs automations skips an event that has not started, because the other Mac cannot tell whether it is starting this moment. That Mac's card says so.
- **A run that was made is never retried.** If Omni errors after it made the thread, the delivery shows Started with the error, linked to the thread. What the run did is unknown, so open the thread and send a follow-up there. Failed always means no thread was made.

Limits, set in the `on:` block of a published-page or webhook automation:

```yaml
on: { event: github_webhook, repo: acme/shop, max_age: 2h, concurrency: 1 }
```

- `max_age` (`90s`, `15m`, `6h`, `2d`; a day by default) skips an event that is older than this when its turn comes. It counts from when the event arrived, so an hour of Omni being off, or the other Mac asleep on a held event, does not revive it. A skipped event stays skipped after a restart or when the automations move to the other Mac. A retry of an event past its age is refused.
- `concurrency` (1 to 8; 2 by default) is how many of the automation's runs may be going at once. The rest of a burst waits as Accepted and starts as runs end, so a hundred events cannot queue ahead of your own messages.
- After a start fails, the automation's other new events wait 30 seconds, then 1 minute, doubling to 15 minutes, until a start works. A retry you ask for is not held by that wait.

The Conductor has the same three actions: `list_automation_deliveries`, `retry_delivery` and `skip_delivery`.
