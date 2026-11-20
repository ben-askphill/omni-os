# Usage analytics

Omni can send usage analytics to your own PostHog project: which screens and features get used, and errors. It sends nothing until you give it a project key, and Settings > About > Usage analytics turns it off for every machine.

## Turn it on

1. Sign up at [eu.posthog.com](https://eu.posthog.com) (the EU region; the free plan is enough) and create a project.
2. Copy the project API key from the project's settings. It starts with `phc_`.
3. In Omni, add it as the global secret `POSTHOG_KEY` (Settings > Secrets). `OMNI_POSTHOG_KEY` in `.env` wins over the secret.
4. In PostHog's project settings, turn on Discard client IP data.

Events reach PostHog's EU host (`eu.i.posthog.com`) within a few seconds. `OMNI_POSTHOG_HOST` sends them somewhere else.

## What is sent

Only the server sends. The Web UI (desktop browser, phone layout and the desktop app) tells the server which screen it shows and which errors it did not catch, and the server checks each event against the list in `packages/shared/analytics.ts` before it goes. A property is a fixed word, a number or a yes/no. Anything else is dropped.

| Event | Properties |
| --- | --- |
| `server_started` | `bundled` (desktop app or a checkout), `sync` |
| `app_opened` | `surface` (web, phone, desktop), `layout` (rail, classic, phone) |
| `screen_viewed` | `surface`, `screen` (route name), `section` (channel tab, thread view or settings section) |
| `thread_created` | `harness`, `source`, `delegated`, `team`, `quick`, `workspace`, `remote` |
| `thread_delegated` | `harness`, `source`, `team` |
| `message_sent` | `harness`, `mode`, `from` (user or conductor), `attachments` (a count), `step` |
| `pr_step_requested` | `harness`, `step` (open, conflicts or checks) |
| `settings_changed` | `setting` (its name), `value` (only for an on/off switch) |
| `$exception` | the error's class and its stack frames as file and function names, `where` (an API route pattern or a screen) |

Every event also carries the app version, the OS and an anonymous install id, and asks PostHog for no person profile and no GeoIP lookup. A custom harness is sent as `custom`, never by its name.

Never sent: message or prompt text, file contents, thread titles, repo, channel, store or account names, ids, paths, secrets, email or an error's message. There is no session replay and no autocapture of what you type or click.

A crash that stops the server is written to `data/analytics-crash.json` and sent on the next start.
