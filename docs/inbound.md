# Inbound messages from other bots

`POST /api/inbound/:name` lets a bot outside this Mac, such as a Grok Bot crewmate, start a thread or post into one. It is the only `/api` route that checks a token, because it is the only one meant to be reached from elsewhere.

## Request

```
POST /api/inbound/grok
Authorization: Bearer <token>
Content-Type: application/json

{"text": "Check the Volero stock feed and report back", "sender": "Firstmate"}
```

| Field | Required | What |
| --- | --- | --- |
| `text` | yes | The message, up to 20,000 characters |
| `sender` | no | Who wrote it on the other side, shown to the agent |
| `thread_id` | no | Post into a thread a bot started, queued after its current turn |
| `channel` | no | A new thread's channel, one of `OMNI_INBOUND_CHANNELS`. The Conductor when unset |
| `title` | no | A new thread's title. Generated when unset |
| `request_id` | no | The sender's id for this message, so a retry into a thread is not sent twice |

The answer is `202` with `{"thread_id", "created", ...}`. A missing or wrong token, and a name with no token set, all get `401`. A thread a bot did not start, and a channel outside the allowlist, get the same `404` as one that does not exist.

`OMNI_INBOUND_CHANNELS` (comma-separated, default `conductor`) is where a bot may start threads. The default leaves the Conductor to decide what runs where.

The agent reads a line naming the sender and the integration, saying it was not typed by Ben, then the text between `--- message <tag>` and `--- end of message <tag>`, where the tag is random per message so the text cannot close the fence early. The sender name is kept to one line. `@` tokens in a bot's text stay text: they are not resolved to files, since the Mentions note says Ben wrote them. The Web UI and the Mac app label the message "From a bot" and list the thread as Inbound.

## Setup

1. Make a token: `openssl rand -hex 32`.
2. Save it in Omni's Secrets (Web UI or Mac app Settings), scope Global, name `OMNI_INBOUND_GROK_TOKEN`. For another integration, use its name: `/api/inbound/foo` reads `OMNI_INBOUND_FOO_TOKEN`. These tokens are never handed to an agent's environment.
3. Set `OMNI_INBOUND_PORT=4749` in `.env` and restart Omni. That port serves `/api/inbound` and nothing else, on loopback.
4. Point a tunnel at that port, never at 4747. With Tailscale Funnel: `tailscale funnel --bg 4749`. The public URL is then `https://<mac>.<tailnet>.ts.net/api/inbound/grok`.
5. Give the URL and token to the bot. On Grok Bot, ask the crewmate to request the token as a secure secret, then paste it into that card, never into chat.

## Why a second port

The rest of `/api` has no auth: the bind address is the only check (README, "Who can call the API"). A tunnel to 4747 would hand the internet your threads, secrets and shells. On the inbound port, every path other than `/api/inbound/:name` is `404`, whatever the token.
