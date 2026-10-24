# Automations

`automations/*.yaml` are shared examples (`morning-coffee`, `weekly-review`, `artifact-comments`, `brain-nightly`, `pr-babysitter`, `fix-failing-checks`), all off until you turn them on. Turning one on or off in the UI writes `automations.<id>.enabled` to `data/omni.config.json`, never the YAML, and `automations.<id>.channel` there moves it to another channel. Your own automations go in `data/automations/`.

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

`timezone` defaults to your timezone from the config (`OMNI_TZ` wins, else the system's). Both folders are watched; edits apply without a restart. The Mac has to be awake at the scheduled time.

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
- The Automations page lists the last deliveries with their outcome: Started (with a link to the run), Held for owner, Failed or Skipped, with the reason.
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
- The signing secret lives in this Mac's Keychain as `OMNI_WEBHOOK_<ID>`. Set it with Set secret on the automation's card (Web UI or Mac app), and paste the same value into the hook's Secret on GitHub. The clients only show whether it is set. It never reaches a thread. Each Mac that receives the hook needs its own copy.
- That route takes no API token: a request proves itself with its `X-Hub-Signature-256`. A body over 1 MB, a content type other than `application/json`, an event the automation does not take, a missing `X-GitHub-Delivery`, a bad signature or another repo is refused before anything is saved. Without a secret on this Mac the route answers 503. GitHub's `ping` gets a 200 and saves nothing.
- Only finished workflow runs (`completed`) and submitted reviews count; other actions get a 202 and save nothing. Runs for fork PRs and reviews from outside the repo's owners, members and collaborators are saved as Skipped unless `trust: any`. Reviews by the `gh` account Omni uses are always skipped, so a run that reviews cannot start the next.
- A valid event is saved as a delivery, keyed by the automation and its `X-GitHub-Delivery` id, before Omni replies (202). GitHub redelivering it, to either Mac, gets the same delivery back (200, `duplicate: true`) and starts nothing more. On a paused automation the Mac that runs automations answers 409 and saves nothing.
- The run's prompt is the automation's prompt plus an `## Event` section with what GitHub sent (workflow, conclusion, branch, commit, run URL; or PR, reviewer, state and up to 1,000 characters of the review), each field cut short, in a code fence, as data. Its title is `<name> · <commit or PR title>`, and its trigger is `event`.
- Deliveries, sync and the other Mac work as for published pages: the Mac that receives the request saves it, and only the Mac that runs automations starts the run.
- Omni does not expose the endpoint to the internet. GitHub reaches it only if you route it there yourself; a signed request from your own network goes the whole way.
