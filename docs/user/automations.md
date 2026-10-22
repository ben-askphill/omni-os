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

Replace `cron` with `on` and the automation runs when something happens on a PR instead of on a schedule:

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

- Omni polls `gh pr list` every `OMNI_AUTOMATION_POLL_SECONDS` (default 120, 15 at least), one call per repo however many automations watch it. Polling, not webhooks: the server is on loopback, GitHub cannot reach it.
- The first poll after an automation is turned on only records what is open, so it never fires for old failures.
- Each run's prompt is the automation's prompt plus an `## Event` section (repo, PR number and title, what happened, branch and URL). Its title is `<name> · #<PR>`, and its trigger is `event` in the run list.
- What each automation has seen lives in kv `automations.events.<id>`, so a restart does not fire again. With sync on, only the Mac that runs scheduled automations polls.
- Drafts are skipped unless `drafts: true`. Run now still works and sends the plain prompt.
- Only trusted authors fire: a PR, review or comment counts when its author is an `OWNER`, `MEMBER` or `COLLABORATOR` of the repo, and a PR from a fork never counts. A run checks out the PR and runs its code with your secrets and `gh` login, so on a public repo anyone could otherwise run code on your Mac by opening a PR. `trust: any` turns this off for that automation; only set it on a repo where you trust everyone who can open a PR.
- The PR's title, branch and the event line reach the run inside a code fence, as data.
