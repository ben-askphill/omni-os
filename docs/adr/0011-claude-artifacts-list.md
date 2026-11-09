# The claude.ai Artifacts list comes from Claude Code's own Artifact tool

Ben wants the Artifacts tab of the Claude app inside Omni: a list of his claude.ai Artifacts that opens each one. There is no public API, SDK, MCP server, embed or webhook for the Artifacts library, and the Compliance API needs an Enterprise admin key. claude.ai pages cannot be framed (`frame-ancestors`), and `claude.ai/api/frame/<id>` answers a Cloudflare challenge to anything that is not a signed-in browser. The claude CLI's Artifact tool can list them, under Ben's own login.

## Decision

- **A refresh is one short Haiku run, not a thread.** `apps/server/claude-artifacts.ts` spawns `claude -p --model haiku --output-format stream-json --tools Artifact` with `--setting-sources project`, `--strict-mcp-config` and `--no-session-persistence`, and asks for `list` calls only. It runs on the machine whose CLI is signed in, whatever harness its threads use.
- **A PreToolUse guard keeps it a listing.** The Artifact tool also publishes and deletes, and titles other people shared are text the model reads. The guard, passed with `--settings` and run with Omni's own Node, lets an Artifact `list` through and blocks every other call with exit 2. The run starts in a 0700 folder in Omni's data dir, so `--setting-sources project` finds no settings but Omni's. The Conductor's `list_claude_artifacts` returns titles as one capped line, labelled as data.
- **Omni reads the tool results, never the reply.** The results come off the stream and are parsed defensively (`packages/shared/claude-artifacts.ts`): a row is found by its claude.ai link, and a listing only counts when its row count matches the count in its own header. Anything else is `format_changed`, and the last good list stays.
- **Failures have codes:** `cli_missing`, `signed_out`, `tool_unavailable`, `limit`, `format_changed`, `timeout`, `failed`. Each keeps the last good list, records a `tool_failures` row (category only) and shows on every client.
- **The cache is machine-local.** `claude_artifacts` and `claude_artifacts_meta` are not synced: each Mac lists the same account itself.
- **One key for both link forms.** `claude.ai/artifact/<id>` is the page's uuid in base58 (Bitcoin alphabet), and older publishes return `claude.ai/code/artifact/<uuid>`. Rows are keyed by the uuid, so a page an Omni thread published joins to its thread in either form. Checked on a real pair: `XYTPbBk9xkJor7Xz1DtD2a` is `f7567ad1-8b55-4689-b824-1a865c7fe003`.
- **Refresh:** opening the screen runs only when the last attempt is over ten minutes old. Refresh always runs. A schedule (Off, every 6 hours, Daily; default Daily) is checked hourly. Type badges come from a second pass (`list scope:types`, then one `list type:<Name>` per type) at most once a day, so a plain refresh is one tool call.
- **Opening leaves Omni, in the Claude app where Omni can tell it is there.** The desktop app asks the OS whether anything handles `claude:` (the Claude desktop app registers it in its Info.plist) and, if so, opens `claude://claude.ai/artifact/<id>`, which the Claude app routes to its artifact viewer; a failed hand-off falls back to https (`apps/desktop/src/open-external.ts`). iOS opens the https link: claude.ai's apple-app-site-association claims `/artifact/*` and `/code/*` for the Claude app, so iOS picks the app or Safari itself, with no `canOpenURL` and no `LSApplicationQueriesSchemes`. A browser keeps https, since it cannot see installed apps and a `claude:` link with no app behind it fails. The https link stays the one shown and copied. Never an in-app web view, which would hold a claude.ai login.
- **Grid previews come from Omni, never claude.ai.** The listing has no preview or screenshot URL and claude.ai pages cannot be framed, so a grid card shows the local file when an Omni thread published the page (an image as is, a page scaled down, both served by Omni) and its type's drawing otherwise. iOS draws every card by type, as its Files grid draws pages.

## Considered

- **Scraping claude.ai or calling its private API with Ben's session cookie.** Omni would hold the cookie and depend on an undocumented endpoint behind Cloudflare. Ruled out, as was reading the Claude desktop app's storage.
- **A Claude Code thread per refresh.** It would leave a thread and transcript behind for every listing.
- **Asking the model to return JSON.** It costs output tokens and trusts the model to copy 150 rows faithfully. The tool's own text is the source.
- **Mapping types on every run.** About eight tool calls instead of one, for badges that rarely change.
- **Offline HTML copies.** Only plain-HTML pages Ben owns can be read, template artifacts would not render, and pages Omni threads published already have a local copy.

## Consequences

- Every refresh is a model call: measured at about $0.0015 of subscription usage and 3 to 4 seconds on CLI 2.1.319, more on the daily type pass.
- The format is undocumented, so a CLI update can break parsing. Omni then says so, keeps the last list, and links to the gallery on claude.ai. The run state records the CLI version to spot it.
- The list is as fresh as the last run on the server. iOS and phone web read the same cache.
- Artifacts shared from another organization are not listed; the tool says so itself.
- The Claude desktop app gates its artifact deep link behind a feature flag. When the flag is off for an account, the app says it could not open the artifact instead of failing the hand-off, so Omni cannot fall back to the browser on its own.
- Personal, single-user use through the official CLI under Ben's own login. Omni never holds a claude.ai cookie.
