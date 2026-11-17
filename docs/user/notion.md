# Notion

Threads read and write Notion through a Notion connection's integration token, not the Notion MCP plugin. The plugin signs in with OAuth, which a headless thread cannot do, so in Omni it only ever reports that it needs authentication.

## Set it up

1. In Notion, open the connection (Settings > Connections > Develop or manage integrations, or `app.notion.com/developers/connections`) and copy its token. Give it the capabilities threads need: read content, update content, insert content, and read user information if threads should see people's names.
2. In Omni, Settings > Secrets, scope Global, name `OMNI_NOTION_TOKEN`. Paste the value.
3. Share pages with the connection (below).

Secrets are per machine and their values never sync. Set the secret on every machine that runs threads, or have the Conductor send it to the other machine with `set_secret` ([Configuration](configuration.md#secrets)). A thread on a machine without it gets no Notion section in its prompt.

## What threads get

When `OMNI_NOTION_TOKEN` is in a thread's environment, Omni adds a Notion section to its prompt. It applies to Claude Code, Codex and Cursor Agent threads on this machine. Hermes and Cursor Cloud get no secrets, and the Conductor delegates Notion work like any other. The section tells the agent to use the token instead of the plugin and its `Notion:*` skills, and names the helper Omni ships beside the charters, `crew/tools/notion.mjs` (no dependencies, Node 18 or later):

| Command | Does |
| --- | --- |
| `me` | The connection's bot user and workspace |
| `search [query] [--type page\|database]` | What the connection can see, newest first |
| `read <id\|url> [--depth N]` | A page as Markdown, or a database's rows |
| `query <database> [filter JSON]` | A database's rows, optionally filtered |
| `create <parent> <title> [Markdown] [--props JSON]` | A page under a page or a database row, its body from Markdown |
| `append <page> <Markdown>` | Markdown added to the end of a page |
| `api <METHOD> <path> [JSON]` | Any other endpoint, JSON out |

Markdown arguments also take `@file` or `-` for stdin. Long tables and lists go out in as many requests as Notion's limit of 100 children per list needs. The helper only sends the token to `https://api.notion.com/v1/` and follows no redirects. A write that fails with a 5xx or no answer is not retried, since it may have landed: the helper says so, with how far a `create` or `append` got. Only a 429 is retried. Without the helper, an agent calls `https://api.notion.com/v1` with `Authorization: Bearer $OMNI_NOTION_TOKEN` and `Notion-Version: 2022-06-28`. The helper never prints the token.

Link previews read the same secret: a Notion link posted in a thread shows its page title ([Link previews](link-previews.md)).

## Share pages with the connection

A connection only sees pages and databases shared with it. Sharing a page also shares every page under it, so share top-level pages and teamspace roots rather than single pages. In Notion, open the page, then ••• > Connections, and add the connection.

- `search` with no query lists everything the connection can see.
- A 404 `object_not_found` on a page that exists means it is not shared. The prompt tells agents to ask you to share it instead of looking for another way in.
- A workspace owner may have to approve the connection before members can add it to pages.
