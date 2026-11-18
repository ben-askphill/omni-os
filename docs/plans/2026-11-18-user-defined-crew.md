# User-defined crew roles

A plan for letting Omni users create and edit their own crew roles (Ben's "agent types"), each with its own instructions, run defaults, memory, connections and permissions, instead of the seven files that ship in `crew/`.

- Status: proposal, nothing built. Task T-AGENTS, 2026-11-18.
- Surveyed: `main` at `9e087e5a` (desktop 0.1.35). Every claim about current behavior cites `path:line` on that commit.
- Wording: the glossary calls these **crew roles** and asks to avoid "agent" (`CONTEXT.md:24-26`). This plan follows it. What the UI calls them is open decision D1.

## Summary

- A crew role today is a markdown file with YAML frontmatter. Shipped ones live in `crew/`, and a file with the same name in `data/crew/` replaces the shipped one whole. Omni reads them from disk on every lookup. There is no UI, no sync and no memory.
- Four role ids are wired into code: `conductor`, `reviewer`, `usage-scan` and `builder`. The reviewer's cross-family rule lives only in the Conductor's charter text.
- Proposal: keep files as the source of truth and copy the automation editor's model (shipped, edited, own, reset, synced as a signed action). Edits to a built-in become an overlay, so release fixes to its charter still arrive. Special behavior moves from id checks to capability flags and server-side rules.
- Memory: an Omni-owned memory folder per role, injected into every harness's prompt. Writes go through a tool and wait for Ben's approval by default.
- Nine slices (S0 to S8) below. Eleven decisions for Ben at the end.
- Addendum A (T-AGENTS-BYO) adds roles that run on the user's own agent: Hermes on a VPS, an eve agent on Vercel, a Cloudflare agent or any A2A endpoint. It adds slices B1 to B8 after S4 and ten more decisions (E1 to E10).

## 1. Current state

### 1.1 Where roles are defined

| What | Where |
| --- | --- |
| Shipped charters, 7 files | `crew/*.md`, path at `apps/server/config.ts:121` |
| Shipped with the desktop app | `SHIPPED_DIRS` at `apps/desktop/scripts/stage.ts:27` |
| User copies replace a shipped file whole | `apps/server/config.ts:122-123`, `apps/server/crew.ts:65-76` |
| Frontmatter fields | `apps/server/crew.ts:7-21`, parsed at `apps/server/crew.ts:23-46` |
| A bad frontmatter becomes an error, not a crash | `apps/server/crew.ts:30-31` |
| `{{placeholders}}` filled in charters | `apps/server/user-config.ts:307-327` |
| Read from disk on every lookup, no cache | `apps/server/crew.ts:65-67` |
| Listed to clients with run validation | `GET /api/crew`, `apps/server/meta-api.ts:25-33` |
| How a user changes one today: copy the file | welcome message, `apps/server/setup-api.ts:107-110`; `docs/user/crew.md:3` |
| No Settings section for roles | `packages/shared/settings-catalog.ts:34-48` |
| Not synced: no crew entity | `apps/server/db/sync.ts:10-12` |
| Same type declared three times | `apps/server/crew.ts:7-21`, `packages/client-core/src/api/crew.ts:4-16`, `apps/web/src/api.ts:191-202` |

Frontmatter today: `name`, `description`, `harness`, `model`, `effort`, `channel` (default channel), `mcp` (extra Omni MCP servers, only `omni` exists) and `delegate_only`.

### 1.2 How a role shapes a thread

- **Creation** (`apps/server/runner/api.ts:118-180`): looks the role up (`:119`), takes its `channel` when the call names none (`:120`), resolves the run as thread, then role, then channel, then Auto (`:124-142`, rules at `apps/server/harness/resolve.ts:1-10` and `:36-67`). Auto reads only the prompt, never the role (`apps/server/runner/api.ts:144`). It applies the reviewer effort cap (`:147`), refuses a delegate-only role on Hermes or Cursor Cloud (`:148`) and stores the role id on the thread (`:162`, column `role TEXT` at `apps/server/db/migrate.ts:40`).
- **Unknown role ids pass silently.** `role` is `z.string().nullish()` (`apps/server/thread-routes-api.ts:77`) and an id with no file becomes `role: null` (`apps/server/runner/api.ts:162`). A typo, or a role deleted later, runs with no charter and no error.
- **Every spawn reads the role again** (`apps/server/runner/spawn.ts:99`). Claude Code gets the prompt on each spawn (`--append-system-prompt`, `apps/server/harness/claude/adapter.ts:137`), Codex on start and resume (`developerInstructions`, `apps/server/harness/codex/session-start.ts:75`). Cursor gets it only on a new chat's first turn (`apps/server/harness/cursor/adapter.ts:89-93`), Hermes once per spawn (`apps/server/harness/hermes/adapter.ts:179-187`) and Cursor Cloud with the first prompt (`apps/server/harness/cursor-cloud/adapter.ts:209`). A charter edit therefore reaches a running Claude or Codex thread at its next spawn, and never reaches a resumed Cursor chat.
- **System prompt** (`apps/server/runner/prompts.ts:130-216`): the charter goes last under "Your role" (`:215`). A role with the `omni` MCP gets a delegation section, except usage-scan (`:161-168`). A delegate-only role loses the workspace, artifacts and browser sections (`:135`, `:169`).
- **MCP servers** (`apps/server/sandbox.ts:254-293`): layered on the user's own MCP config. The browser goes to every role that is not delegate-only (`:269`); the conductor tools go to roles with `mcp: [omni]` (`:287-288`), every other role gets the threads server (`:290`).
- **Tool limits** for a delegate-only role: Claude Code `--disallowedTools` (`apps/server/harness/claude/adapter.ts:144`, list at `apps/server/crew.ts:53-56`), Codex read-only sandbox (`apps/server/harness/codex/session-start.ts:74`), Cursor deny config (`apps/server/harness/cursor/adapter.ts:65`, rules at `apps/server/sandbox.ts:324`), Hermes refused (`apps/server/harness/hermes/adapter.ts:251`).
- **Claude model fallback**: the role's model when the thread names none (`apps/server/harness/claude/adapter.ts:108-110`).
- **Secrets**: every thread gets all global secrets plus its channel's. The role plays no part (`apps/server/secrets.ts:105-118`, `apps/server/runner/spawn.ts:134`).
- **Skills**: Omni does not pick them. Claude Code finds the user's and the repo's skills itself, plus Omni's mods plugin (`apps/server/harness/claude/adapter.ts:81-84`, `:145`). Codex lists skills per folder (`apps/server/harness/codex/commands.ts:13-36`).
- **Memory**: Omni has none of its own. Claude threads get the workspace folder and its `CLAUDE.md` added (`apps/server/harness/claude/adapter.ts:140`, `:154`; folder at `apps/server/config.ts:45-52`). Harness-native memory, such as Claude Code's per-repo auto memory, is outside Omni.
- **The role survives a switch or continue**: `apps/server/runner/switch.ts:35`, `apps/server/continue.ts:229`. Crew reports name it: `apps/server/runner/queue.ts:206`, `:214`.

### 1.3 How the Conductor picks roles

- `list_crew` returns id, name, description and default channel, and hides only the conductor (`apps/mcp/omni.ts:74-78`). It still lists usage-scan, whose own description says never to delegate to it (`crew/usage-scan.md:3`).
- `delegate` takes a role id and leaves the run to the role's defaults (`apps/mcp/omni.ts:80-132`); `delegate_team` takes one role for the lead and per task (`:134-174`).
- External MCP clients get the same `list_crew` (`apps/mcp/external/tools.ts:88-92`).
- The Conductor's charter maps work to roles (`crew/conductor.md:26`), leaves the run to the role (`:28`), owns the PR review family rule (`:45-48`) and proposes charter edits to Ben instead of making them (`:41`).
- New roles already reach the Conductor without a restart, because `list_crew` calls the API, which reads the files each time.

### 1.4 Role ids wired into code

| Id | Where | What it does |
| --- | --- | --- |
| `conductor` | `apps/server/crew.ts:75` | Sorted first |
| `conductor` | `apps/server/runner/api.ts:127-130`, `packages/shared/draft-run.ts:38-40` | A saved #conductor channel run beats the charter |
| `conductor` | `apps/web/src/components/Composer.tsx:132-133`, `apps/web/src/mobile/NewSheet.tsx:80`, `apps/ios/src/newthread/draft.ts:26-28` | Attached automatically in #conductor |
| `conductor` | `apps/mcp/omni.ts:77` | Hidden from `list_crew` |
| `conductor` | `apps/server/pr-review.ts:13`, `apps/server/setup-api.ts:128` | Review report parent, welcome thread |
| `reviewer` | `apps/server/harness/resolve.ts:69-87`, `apps/server/runner/api.ts:147`, `apps/server/runner/switch.ts:35` | A GPT reviewer runs at `high` whatever was asked |
| `reviewer` | `crew/conductor.md:45-48` | Cross-family pick, in charter text only |
| `reviewer` | `crew/reviewer.md:11` | "Read only" is charter text; the tools are not limited |
| `usage-scan` | `apps/server/usage-scan/asks.ts:8`, `apps/server/usage-scan/scan.ts:139` | Omni starts it with the scan report |
| `usage-scan` | `apps/server/automation-guard.ts:42-45`, `:6-7` | Its thread may create automations once Ben answered |
| `usage-scan` | `apps/server/runner/prompts.ts:161` | No delegation section |
| `builder` | `apps/server/pr-review.ts:36-38` | The Review PR action runs as builder |

Avatars: fixed marks for five ids in `packages/shared/brand.ts:20-121`. Reviewer, usage-scan and any new role get no mark (`apps/web/src/components/brand.tsx:213-216`, `apps/web/src/components/composer/pickerOptions.tsx:30`).

Related, not keyed on the role: Auto sends any prompt that reads like a code review to Codex at `high` (`apps/server/harness/auto.ts:40`, `:278`; `docs/user/harnesses.md:89`).

### 1.5 Ben's own content ships to every user

The shipped charters name Ben's setup: the Ask Phill Portal (`crew/researcher.md:8`), the APA skills (`crew/builder.md:10`), Productive (`crew/inbox.md:3`, `:7`) and a Shopify-only role (`crew/store-ops.md`). `crew/` ships through the same `SHIPPED_DIRS` (`apps/desktop/scripts/stage.ts:27`) that carried Ben's automations into the public release. Thread 5e553d12 (T-5E55, "Remove Ben's automations from the default Omni release") is fixing that for `automations/` now. Slice S0 does the same for `crew/`.

### 1.6 Gaps this plan closes

- No way to manage roles from any client; users copy files by hand.
- A user copy shadows the shipped file forever. Once Ben or a user copies `conductor.md`, later shipped fixes (like #785, reviews only when asked) never reach them, and nothing says so.
- Edits stay on one machine.
- Unknown role ids run with no charter.
- Special behavior hangs on ids, and one rule (review family) hangs on prose a user could edit away.
- Browser, secrets and MCP servers are all or nothing per thread.

## 2. Data model

### 2.1 Storage: files, as today

Keep markdown plus frontmatter, one file per role, and copy the automation model that already works:

- Shipped: `crew/<id>.md`, read-only, replaced by each release.
- The user's: `data/crew/<id>.md`. For a shipped id it is an **overlay**; for a new id it is the whole role.
- Kind of each role, as `sourceKind` does for automations (`apps/server/automation-files.ts:66-77`): `shipped`, `edited` or `own`.
- Writes go through one store module (as `apps/server/automation-store.ts:31-42` does), which also records the sync change.

Why files over a database table: charters stay editable in any editor and readable by agents, the read-every-time behavior keeps working, and the automation editor, sync handler and reset already prove the pattern. A table is decision D2.

### 2.2 Fields

```yaml
---
# Identity
name: Store ops                  # display name, editable; the id is the file name and never changes
description: Hands-on Shopify store work...   # list_crew and pickers show it
avatar: { icon: cart, bg: amber }  # shared icon set + avatar background palette, as channels use; built-ins keep their marks

# Instructions
charter_mode: append             # append (default for a built-in): the body is added after the shipped charter
                                 # replace: the body is the whole charter (today's behavior for a copy)
based_on: 3f9c1e...              # hash of the shipped charter this edit was made against (set by Omni)

# Run defaults: same meaning as today (resolve.ts)
harness: claude-code             # or omit
model: auto                      # auto, a catalog id or a Claude alias
effort: high
auto:
  harnesses: [claude-code]       # new: harnesses Auto may pick for this role (inbox needs connectors)

# Where
channel: inbox                   # default channel when a delegation names none (today's field)
channels: []                     # new, optional: channels this role may run in; empty means any

# Powers
tools: full                      # full | no-edits | delegate-only (delegate_only: true still reads as delegate-only)
browser: true                    # new: the omni-browser MCP
mcp: [omni]                      # Omni's own servers, as today
review: false                    # new capability: a review role (GPT effort cap, cross-family pick)
delegatable: true                # new: list_crew and pickers offer it; false for usage-scan

# Connections
connections:
  mcp: [shopify-dev]             # named servers from a new MCP registry in Settings, added to this role's threads
  skills: [apa-feature]          # named in the prompt; packaged with the role for Claude Code (section 2.4)
  secrets: [SHOPIFY_TOKEN]       # allowlist of secret names; omitted means every secret, as today

# Memory
memory: read-write               # off | read | read-write
memory_writes: review            # review (default) | auto
---
Charter text. Placeholders work as today.
```

Rules:

- **Ids**: lowercase words and dashes, like automation ids (`apps/server/automation-store.ts:11`). Immutable: the thread table and automation YAMLs store them (`apps/server/db/migrate.ts:40`, `docs/user/automations.md:24`). Renaming changes `name` only.
- **Reserved ids**: `conductor`, `reviewer` and `usage-scan` can only be overlays on the shipped file, never new roles (section 5).
- **Hide, not delete, for built-ins**: a per-machine flag in the user config, as automations already do with `deleted` (`apps/server/user-config.ts:60`). Own roles can be deleted. Threads keep the id; clients show the id when no role has it, as the automation editor already does (`apps/web/src/components/AutomationEditor.tsx:134`).
- **Unknown or hidden ids are refused** on thread create, with the valid ids in the error (fixes `apps/server/thread-routes-api.ts:77`).
- **Validation on save**: run defaults through `validateDefaults` (`apps/server/harness/resolve.ts:90-104`), locked fields for reserved roles, known secret and MCP names.

### 2.3 Seeding built-ins without clobbering edits

Built-ins are never copied into `data/`. Omni reads the shipped file and lays the user's overlay over it at read time. So:

- **A release never overwrites a user edit.** It only replaces `crew/`, which the user never writes. Already true today (`apps/server/crew.ts:65-76`).
- **A user edit no longer hides release fixes.** With `charter_mode: append`, a shipped charter change flows through and the user's additions stay after it. Field overrides (model, channel) override one field each.
- **Replaced charters get a notice.** With `charter_mode: replace`, Omni compares `based_on` with the current shipped hash. When they differ, the role shows "Built-in charter changed" with a diff and three actions: keep mine, take the new one, or move my text into additions.
- **Hidden stays hidden** across releases (user config flag), and a new shipped role shows up as new.
- **The release carries no one's personal roles** (S0): shipped charters hold only generic text and `{{placeholders}}`. A stage-time check fails the build when `crew/` names a user, company or client, the same kind of guard T-5E55 is adding for `automations/`. Ben's own roles move to his `data/crew/` and reach his other machines through sync (S2).

### 2.4 Connections: what Omni can enforce

| Control | Claude Code | Codex | Cursor Agent | Hermes | Cursor Cloud |
| --- | --- | --- | --- | --- | --- |
| Charter and memory | every spawn | start and resume | first turn of a chat | once per spawn | first prompt |
| Delegate-only | enforced | enforced (read-only sandbox) | enforced (deny config) | refused | refused |
| No-edits (new) | `--disallowedTools` Edit, Write, NotebookEdit | read-only sandbox, which also stops shell writes | deny `Write(**)` | prompt only | prompt only |
| Browser off (new) | enforced | enforced | enforced | not offered | not offered |
| Extra MCP servers (new) | `--mcp-config` | thread config | plugin `.mcp.json` | no | no |
| Secrets allowlist (new) | enforced (env) | enforced (env) | enforced (env) | no Keychain secrets today | no Keychain secrets today |
| Skills | role skills as a plugin dir; others named in the prompt | named in the prompt | named in the prompt | no | no |

Sources for today's columns: section 1.2. Notes:

- **No-edits leaves Bash on Claude Code**, so it stops the edit tools, not a shell command that writes. The UI says so. The reviewer keeps Bash for `gh pr diff` and running checks.
- **MCP is additive in v1.** Omni adds servers on top of the user's own config (`apps/server/sandbox.ts:254`). Taking the user's global servers away per role would need each harness's strict mode, untested here (D8).
- **Secrets**: a new scope `crew:<id>` beside `global` and `channel:<id>` (`apps/server/secrets.ts:32`), and an optional allowlist filter in `secretsEnv`. No allowlist means today's behavior.
- **Skills**: Omni cannot reliably hide skills a harness finds on its own. It can add them: a role's `skills/` folder ships to Claude Code as one more `--plugin-dir`, the way mods do (`apps/server/harness/claude/adapter.ts:145`). For other harnesses the prompt names the skills to prefer.

## 3. Per-role memory

### 3.1 What exists

| Layer | Scope | Written by | Where | Good for |
| --- | --- | --- | --- | --- |
| Thread session | one thread | the harness | harness session store, resumed by id (`apps/server/harness/claude/adapter.ts:146`) | the conversation |
| Harness project memory | one repo, Claude Code only | the model | outside Omni (`~/.claude/projects/<repo>/memory`) | repo facts |
| Channel notes | one channel, every role | Ben | channel row, in every prompt (`apps/server/runner/prompts.ts:159`) | client facts |
| Workspace `CLAUDE.md` | every Claude thread | Ben | workspace folder (`apps/server/harness/claude/adapter.ts:140`, `:154`) | who the user is |
| Central brain | Ben's knowledge base | agents add dated raw notes, a nightly job files them | `~/central-brain`, Ben's setup, not an Omni feature | decisions, incidents |

Nothing holds "how this role should work", and nothing carries a lesson across harnesses: a builder that learns something on Claude Code forgets it on Codex.

### 3.2 Options

1. **Harness memory only** (today). No work, but per harness and per repo, invisible in Omni, and gone when Auto moves a role to another harness.
2. **Central brain as role memory.** Ben has one; most users won't. It holds knowledge about Ben's work, not role behavior, and the wiki is not to be edited from other repos.
3. **Omni-owned memory per role** (recommended). `data/crew/<id>/memory/`: a `MEMORY.md` index plus one file per fact, in the same frontmatter format Claude Code memory uses, so Ben's existing memories can be imported.
4. **Per role and channel stores.** Precise but multiplies stores. A `channel:` tag on a fact gets most of the benefit (below).

### 3.3 Recommendation

- **Read**: the index goes into the system prompt under "Your memory" for every harness, capped in size. Local harnesses can open the fact files by path. Remote ones get the capped text only. A fact tagged `channel: acme` is injected only in #acme.
- **Write**: a `remember` tool, on the threads MCP server every non-Conductor role already gets (Rust, `crates/omni-mcp`) and on the conductor tools. It posts to `POST /api/crew/:id/memory`. Omni masks secret values before saving (the scan's masking, `apps/server/secrets.ts:93-96`).
- **Review by default.** A memory is a prompt every future thread of that role runs with full permissions, so one poisoned web page could otherwise plant a lasting instruction. New facts wait in the role's Memory tab until Ben approves. A role can switch to `memory_writes: auto`, and every auto write is logged with its thread. Threads below an automation can propose but never auto-write, the same lineage rule as `apps/server/automation-guard.ts:3-5`.
- **Sync** as a signed action entity, like automation files (`apps/server/sync/verify.ts:42-45`).
- **Relation to the rest**: channel notes stay for client facts, harness memory stays for repo facts, the central brain stays Ben's. Role memory is for how the role works: corrections Ben made, what the Conductor saw it miss (today the Conductor proposes a charter edit for that, `crew/conductor.md:41`; small lessons can become a memory instead).

## 4. UI

### 4.1 Where roles are managed

- **Settings > Agents > Crew**, a new section in the existing Agents group (`packages/shared/settings-catalog.ts:11`, `:37-39`). Desktop web, phone web and the desktop app draw Settings from that catalog (`packages/shared/settings-catalog.ts:1-3`), so all three get it from one change. iOS draws Settings from the same catalog too and gets its own slice (S8).
- **List**: avatar, name, description, run summary (Auto, or harness and model), and chips for Built-in, Edited, Yours, Hidden, "Built-in charter changed" and any validation error (already returned by `apps/server/meta-api.ts:30`).
- **Editor**: Form and Markdown tabs, as the automation editor has Form and YAML (`docs/user/automations.md:9`). Form groups: Identity, Instructions (with Add to built-in or Replace), Run (the composer's harness, model and effort pickers, plus Auto limits), Where, Powers, Connections, Memory (facts with edit, delete and the approval queue).
- **Actions**: New, Duplicate (new id, a full copy in replace mode), Delete (own roles), Hide and Show (built-ins), Reset to built-in (edited built-ins, as `resetAutomation` does at `apps/server/automation-files.ts:270-275`), Compare with built-in.
- **Locked fields** on reserved roles show why they are locked (section 5).
- **Avatars**: the channel avatar model (shared icon set and backgrounds). The avatar picker, source chips and memory row are new components, so they go into the Claude Design system in the same slice (repo rule in `CLAUDE.md`).
- **Composer role pickers** list roles with their avatars and hide `delegatable: false` ones (`apps/web/src/components/composer/pickerOptions.tsx:28-31`, `apps/web/src/components/AutomationEditor.tsx:133`).

### 4.2 Per-channel overrides

Not in v1 (D7). Channel notes already add per-channel instructions to every role (`apps/server/runner/prompts.ts:159`) and channel-tagged memory covers lessons. Channel settings get a read-only "Crew here" list: roles whose default channel this is, and roles restricted to it. If overrides come later, they sit between the thread's choice and the role's default in the resolver (`apps/server/harness/resolve.ts:1-10`).

### 4.3 How the Conductor picks them up

- `list_crew` adds `channels`, a run summary and `tools`, and drops hidden and non-delegatable roles (`apps/mcp/omni.ts:77`). Same for the external MCP (`apps/mcp/external/tools.ts:91`).
- `delegate` and `delegate_team` refuse an unknown, hidden or non-delegatable role, or a channel outside the role's `channels`, with the valid ids in the error.
- New tools: `get_crew_role`, `save_crew_role`, `reset_crew_role` and `crew_memory` (list, approve, drop). `save_crew_role` only runs after Ben agrees in the thread and is refused from any thread below an automation (the automation guard's rules, `apps/server/automation-guard.ts:1-11`). That lets the Conductor apply the charter edits it already proposes (`crew/conductor.md:41`) once Ben says yes.
- No restart needed: roles are read on every call (section 1.3). The wire fixture `packages/test-fixtures/wire/crew.json` changes with the new fields.

## 5. Roles that stay special

| Role | Why | How it stays safe |
| --- | --- | --- |
| Conductor | The front agent: attached in #conductor, routes only, holds the omni tools | Reserved id. Can't be hidden, deleted or duplicated as a conductor. `tools: delegate-only` and `mcp: [omni]` locked. Local harnesses only (already `apps/server/runner/api.ts:148`). Charter edits default to Add to built-in. A save that drops delegate-only is refused. Reset always available |
| Reviewer | GPT effort cap keyed on its id; cross-family rule in Conductor prose | Replace the id check with the `review` capability, locked on for `reviewer`. Move the family pick into the server: `delegate` takes `review_of: <thread id>` and picks the other family from that thread's run, refusing the same family. The rule from `crew/conductor.md:45-48` becomes code with tests, and the charter shrinks to "pass `review_of`". Ships with `tools: no-edits` (D11) |
| Usage scan | The automation guard grants its thread create rights by id (`apps/server/automation-guard.ts:42-45`); only Omni starts it | Reserved id, `delegatable: false`, hidden from `list_crew` and pickers. Charter Add-only, `tools: delegate-only` locked. Run fields editable within local harnesses. No duplicate: a copy would not get the guard's grant, so it would only confuse |
| Builder | The Review PR action hard-codes it (`apps/server/pr-review.ts:38`) | Built-in, hideable not deletable. The action uses `builder` while it exists and refuses with a message when it is hidden |

General rules:

- **A role definition is a prompt that runs with full permissions**, on every machine that syncs it. It syncs as a signed action entity, held for untrusted machines like automation files (`apps/server/sync/verify.ts:42-45`). Agent writes go through the guard.
- **Capabilities, not ids, carry behavior**, except the two singletons (conductor, usage-scan) whose behavior is about Omni itself.
- **Auto still never picks Hermes or Cursor Cloud**, and a role's `auto.harnesses` only narrows Auto's choice.

## 6. Migration and slices

### 6.1 Migration

- **Format**: every current frontmatter key keeps its meaning. `delegate_only: true` reads as `tools: delegate-only`.
- **Existing copies in `data/crew/`**: a file with no `charter_mode` and a shipped twin reads as `replace` (today's behavior) with `based_on` unknown. The list marks it "Compare with built-in" once, so Ben sees what he is missing, starting with his own `conductor.md` if he has one.
- **Threads, automations and reports** store ids, which do not change. Nothing in the database migrates.
- **Ben's personal content** moves from `crew/` to his `data/crew/` in S0, and S2 syncs it to his other machines.

### 6.2 Slices

Ordered. Each slice ships on all three surfaces where it has UI, per the repo rules.

| Slice | Scope | Needs |
| --- | --- | --- |
| S0 Release hygiene | Generic shipped charters; Ben's roles move to his `data/crew/`; stage-time guard on `crew/` | T-5E55's automations guard, to share its check |
| S1 Store and API | Crew store module, overlay merge, `based_on`, shipped/edited/own, hide, CRUD and reset routes, refuse unknown ids on create, `delegatable` in `list_crew`, wire fixture, `docs/user/crew.md` | none |
| S2 Sync and guard | `crew_file` signed action entity with last-writer-wins handler, sync backfill label, guard for agent writes | S1 |
| S3 Settings > Crew | List, Form and Markdown editor, duplicate, delete, hide, reset, compare; avatars; design system components | S1 |
| S4 Capabilities | `review` flag in `reviewerEffort`, reserved ids and locked fields, `review_of` on `delegate`, Conductor charter trimmed | S1 |
| S5 Powers and connections | `tools: no-edits`, `browser`, `channels`, secrets allowlist and `crew:<id>` scope, MCP registry and per-role servers, role skills plugin dir, `auto.harnesses` | S1; UI in S3 |
| S6 Role memory | Memory store, prompt injection, `remember` tool (Rust threads server and conductor tools), approval queue, synced entity | S1, S2, S3 |
| S7 Conductor tools | `get_crew_role`, `save_crew_role`, `reset_crew_role`, `crew_memory`, external MCP fields, charter update | S1, S2, S4 |
| S8 iOS | Settings > Crew list and editor through `@omni/client-core` | S1, S3 |

S1 to S4 give a usable feature: roles you can create, edit, sync and trust. S5 to S8 deepen it.

## 7. Open decisions for Ben

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | What the UI calls them | "Crew" (glossary) or "Agents" | Crew, as a section in the existing Agents group |
| D2 | Storage | Markdown files, or a database table | Files |
| D3 | Editing a built-in charter | Add to it (overlay), replace it (today), or per-field only | Add by default, Replace as an option with the change notice |
| D4 | Which roles ship | All seven, or a generic core | Generic core; store-ops and Ben's flavor move to his own set |
| D5 | Memory writes | Review queue, auto-write, or Ben writes only | Review by default, per-role auto |
| D6 | Memory scope | Per role with channel tags, per role and channel, or none | Per role with channel tags |
| D7 | Per-channel role overrides | Not in v1, or an override layer | Not in v1 |
| D8 | MCP per role | Additive, or strict (drop the user's global servers) | Additive in v1 |
| D9 | Secrets per role | Every secret unless listed (today), or none unless listed | Every secret unless listed; the Conductor ships with none |
| D10 | Conductor edits roles | After Ben agrees in the thread, or UI only | After Ben agrees, never from automation threads |
| D11 | Reviewer tools | No-edits enforced, or charter text only (today) | No-edits enforced, Bash kept |

Why:

- **D1**: `CONTEXT.md:24-26` already settled "crew role" and Settings already has an Agents group with harnesses and accounts (`packages/shared/settings-catalog.ts:11`). Calling roles "Agents" would put two meanings on one word.
- **D2**: files keep hand edits, agent-readable diffs and read-every-time behavior, and reuse the automation editor, store and sync handler. A table makes field-level sync easier but splits the source between shipped files and rows.
- **D3**: replace-only is why a copied charter silently misses fixes like #785. Add-to keeps both.
- **D4**: the same leak as the automations bug. A user who does Shopify work can duplicate a template from the docs or the Conductor can write one.
- **D5**: a memory is a lasting prompt. Review closes the prompt-injection path; auto stays available where Ben trusts the role's inputs.
- **D6**: one store per role stays small and visible; tags give channel-specific lessons without a store per channel.
- **D7**: channel notes plus tags cover most cases, and a fourth resolver layer would complicate the rules in `apps/server/harness/resolve.ts:1-10`.
- **D8**: Omni layers on the user's MCP config today and each harness's strict mode is untested here; additive keeps claude.ai connectors working.
- **D9**: no change for existing threads. The Conductor needs no secrets, so it can ship with an empty list.
- **D10**: the Conductor already drafts charter edits; applying them after a yes saves Ben the copy and paste, and the automation guard's lineage rule keeps loops out.
- **D11**: today a reviewer can edit and push despite its charter (`crew/reviewer.md:11`). No-edits stops the edit tools and keeps Bash for `gh` and checks.

## Addendum A. Bring your own agent

Ben wants users to add agents they run themselves to the crew, next to Claude Code, Codex and Cursor. Examples are Hermes Agent on a VPS, an agent built on Vercel's eve framework and a Cloudflare agent.

- Status: proposal, nothing built. Task T-AGENTS-BYO, 2026-11-18. Read-only survey of the same commit, `9e087e5a`.
- Omni claims cite `path:line`. Claims about outside frameworks cite the doc page, read on 2026-11-18.
- Wording: the glossary calls the thing a thread runs in a **harness** and asks to avoid "runtime" and "provider" (`CONTEXT.md:100-102`). The brief's "runtime adapter" is the harness adapter here. A user's own agent joins as a **custom harness**, one the user registers and Omni reaches over the network. "Remote harness" covers Hermes, Cursor Cloud and custom ones; ADR 0003 uses that term, and the code says provider harness (`apps/server/harness/types.ts:11-17`). The crew role stays who does the work. A role binds to a custom harness the way it binds to Codex today.

### A.0 Summary

- The seam exists. Every harness runs behind `HarnessAdapter` and `HarnessSession` (`apps/server/harness/adapter.ts:100-130`). Hermes and Cursor Cloud already use it with no process (`apps/server/harness/session.ts:44-64`).
- The list is closed. `HarnessId` is a fixed union of five ids (`apps/server/harness/types.ts:7-9`). Hermes has one global URL and one global key (`apps/server/config.ts:61-64`, `apps/server/runner/spawn.ts:137`). Capabilities cover steer, interrupt, images and usage, nothing else (`apps/server/harness/types.ts:28-40`).
- Proposal: a custom harness is a synced file with a kind (its wire protocol), a URL, the name of an auth secret and declared capabilities. Roles bind to it by id. Omni reads capability flags, not `harness === 'hermes'`, to decide what it offers, refuses or warns about.
- First adapter: turn the Hermes adapter into kind `runs-api` with any number of instances, and document its HTTP shape as Omni's remote harness protocol. eve and Cloudflare agents can serve it from a small shim.
- Second adapter: A2A 1.0, the one stable protocol for remote agents. eve already serves it. It has no usage and no tool-call events, so those degrade.
- Security: a remote agent runs its own tools with its own secrets, and Omni cannot limit either. Its reply reaches the Conductor as a crew report. Remote harnesses never run delegate-only roles and never get the install's API token. They get Omni tools only through a scoped per-thread token, in a later slice.

### A.1 How Hermes is wired today

Hermes is the reference remote harness. ADR 0003 records the decision (`docs/adr/0003-hermes-remote-harness.md:3-14`). This is what ships:

| Step | What happens | Where |
| --- | --- | --- |
| Config | One base URL, from `OMNI_HERMES_URL` or Settings. Unset means off | `apps/server/config.ts:61-64`, `apps/server/user-config.ts:224` |
| Auth | One global secret, `HERMES_API_KEY`, sent as a Bearer header and never as an env var | `apps/server/runner/spawn.ts:134-141`, `apps/server/harness/hermes/adapter.ts:54-58` |
| Env guard | Every harness's environment drops `HERMES_API_KEY` | `docs/user/harnesses.md:17` |
| Availability | `GET /v1/capabilities` answers 200. Redirects are not followed, so the token cannot reach another host | `apps/server/harness/hermes/client.ts:69-90`, probe at `apps/server/harness/catalog-service.ts:218-227` |
| Catalog | One model, "Hermes default". The server picks the LLM | `apps/server/harness/catalog.ts:141-166` |
| Capabilities | No warm process, steer and interrupt, no inline images, no plan usage | `apps/server/harness/types.ts:48-49` |
| Adapter | Looked up by id. An unknown id falls back to Claude Code | `apps/server/runner/state.ts:24-31` |
| Session | No process. `detachedSession` ends on the first `end` | `apps/server/harness/session.ts:44-64` |
| Session id | `omni-<thread id>` continues the remote conversation | `apps/server/harness/hermes/adapter.ts:35-36`, `:49`, `:55-56` |
| Start a turn | `POST /v1/runs` with `input`, `session_id` and, on the first run, `instructions`. A 400 that names instructions moves the prompt into the first message | `apps/server/harness/hermes/adapter.ts:175-193`, `apps/server/harness/hermes/client.ts:125-135` |
| Retries | The message uuid is the `Idempotency-Key`. A 429 backs off and retries with the same key | `apps/server/harness/hermes/client.ts:105-123`, `:130` |
| Tool-failure policy | Goes in front of the first input of a resumed session | `apps/server/harness/hermes/adapter.ts:66-68`, `:176` |
| Events | SSE on `GET /v1/runs/{id}/events`. `seq` drops replayed events. One reconnect, then up to three `GET /v1/runs/{id}`, then the turn fails and Omni stops the run | `apps/server/harness/hermes/adapter.ts:103-159`, `apps/server/harness/hermes/client.ts:173-211` |
| Normalizing | Deltas become one bubble, `tool.*` become tool rows under Claude's tool names, `subagent.*` become tasks, `run.*` become status and result | `apps/server/harness/hermes/normalize.ts:10-24`, `:180-292` |
| Steer | `POST /v1/runs/{id}/steer`. A 409 or 400 queues the text as the next run | `apps/server/harness/hermes/adapter.ts:219-240`, `apps/server/harness/hermes/client.ts:148-153` |
| Interrupt | A `control` record acks at once, then `POST /v1/runs/{id}/stop` | `apps/server/harness/hermes/adapter.ts:279-285` |
| End | Aborts the stream and stops the active run | `apps/server/harness/hermes/adapter.ts:242-247` |
| Approvals | `approval.request` shows as a status line. The client has `approval()`, and nothing calls it | `apps/server/harness/hermes/normalize.ts:263-269`, `apps/server/harness/hermes/client.ts:166-171` |
| Usage | Tokens, cache tokens and the serving model land on the result record. Nothing adds them up. Accounts says "not reported" | `apps/server/harness/hermes/normalize.ts:136-157`, `apps/server/stream.ts:39-44`, `apps/server/harness-accounts.ts:144-158` |
| Attachments | Described in the message and not transferred | `apps/server/harness/hermes/adapter.ts:20-33` |
| Workdir | The thread's data folder. No worktree and no branch | `apps/server/sandbox.ts:52-55`, `apps/server/runner/api.ts:153-170` |
| MCP and browser | None. No MCP config file, no browser hold, no design-system file | `apps/server/runner/spawn.ts:101-130` |
| Prompt | Hard-coded "You are Hermes, running on your own server", work on your own clone, no Keychain secrets, no html_render | `apps/server/runner/prompts.ts:139-142`, `:150-151`, `:182-184`, `:190-193` |
| Roles | Thread create and the adapter both refuse a delegate-only role | `apps/server/runner/api.ts:148`, `apps/server/harness/hermes/adapter.ts:249-265`, reason at `apps/server/crew.ts:58-63` |
| Auto | Never picks Hermes | `apps/server/harness/auto.ts:294-297` |
| Switch and continue | Refused to or from Hermes | `apps/server/runner/switch-plan.ts:19-20`, `:35`, `docs/user/harnesses.md:65` |

Other code that branches on `isProviderHarness` and would read a capability instead: `apps/server/actions.ts:76`, `:84`, `apps/server/changes.ts:50`, `apps/server/continue.ts:67`, `:170`, `apps/server/handoff.ts:315`, `:439`, `apps/server/turns.ts:31`, `apps/server/message-context/project.ts:55`, `apps/server/runner/fresh-context.ts:42`, `apps/server/runner/setup-action.ts:58`, `apps/server/runner/teardown-action.ts:18`, `apps/server/runner/snapshots.ts:60`, `apps/server/runner/prompts.ts:77`, `:87`, `:98`, `apps/server/sync/files.ts:841`.

Doc drift: ADR 0003 still says the adapter holds a dummy process open (`docs/adr/0003-hermes-remote-harness.md:5`). The code uses `detachedSession`. B1 fixes the ADR.

What Hermes shows about any remote agent:

- **One instance.** One URL and one key, so a second server cannot be added.
- **Its PRs are invisible.** A remote thread has no branch (`apps/server/runner/api.ts:170`), so crew PRs (`apps/server/crew-prs.ts:23-25`), PR watch (`apps/server/pr-watch/api.ts:33`) and the thread card miss what it opened. Cursor Cloud reports its branch and PR, but only in a transcript row (`apps/server/harness/cursor-cloud/normalize.ts:11-24`, `apps/server/stream.ts:68-84`). Nothing writes them to the thread.
- **Spend is shown, not counted.** Token counts stop at the result record.
- **Approvals dead-end.** The agent waits, and Ben sees a status line with no button.
- **An unknown harness id runs on Claude Code.** `adapterFor` falls back to `claudeAdapter` (`apps/server/runner/state.ts:31`). With five fixed ids that never happens. With user-defined ids, a deleted harness would run its threads on this Mac with full permissions.

### A.2 What a harness adapter contract needs

The runner side stays as it is: `spawn`, then `send`, `interrupt` and `end`, with the callbacks (`apps/server/harness/adapter.ts:14-33`, `:65-98`, `:100-130`). The runner already degrades by capability. It queues a steer for a harness that cannot steer, and stops the session for an interrupt the harness cannot take (`apps/server/runner/queue.ts:56-90`). What is new is the wire side, meaning what a remote agent has to offer, and flags for what it lacks.

| Need | Omni today | The remote offers | Without it |
| --- | --- | --- | --- |
| Start | `spawn(ctx)` gets the system prompt, secrets and a resume flag (`apps/server/harness/adapter.ts:14-33`) | Create a run on a key Omni sends, so a retry makes no second run. Take Omni's prompt as instructions | The prompt goes in the first message, as Hermes' fallback and Cursor Cloud do (`apps/server/harness/cursor-cloud/adapter.ts:209`) |
| Stream events | `cb.record` into Omni's record kinds (`apps/server/stream.ts:6-46`) | Ordered events with a cursor: text, tool start and end, subtasks, status, one terminal event per turn. A status call for a dropped stream | Polling, as Cursor Cloud does (`apps/server/harness/cursor-cloud/adapter.ts:1-5`). No tool rows |
| Steer | `send()` during a turn, `steer` flag (`apps/server/harness/types.ts:32-33`) | Add a message to the running turn, and say when the turn already ended | Queued as the next turn (`apps/server/runner/queue.ts:68-71`) |
| Interrupt | `interrupt(requestId)`, answered by a `control` record (`apps/server/harness/adapter.ts:111-115`) | Cancel the turn and keep the session | Stop ends the session (`apps/server/harness/types.ts:34-35`) |
| Resume | `cb.session` stores the session id on the thread (`apps/server/harness/adapter.ts:71-72`), `ctx.resume` (`:29-30`) | A durable session that the next turn continues, by an id Omni picks or stores | Refused in this plan. A transcript replay per turn would reuse the Carryover (`CONTEXT.md:125`) and can come later |
| Artifacts | `artifacts/` exists only on the Mac (`docs/adr/0003-hermes-remote-harness.md:9`) | An artifact event with a name, a media type, and a URL or small inline bytes | Links in the reply text, as today |
| PRs | Found through the thread's branch (`apps/server/crew-prs.ts:23-25`) | Report the repo, branch and PR it pushed, or push to a branch Omni names | No PR on the thread card, in crew PRs or in PR watch |
| Tools and MCP | Local harnesses get Omni's MCP servers (`apps/server/sandbox.ts:254-293`). Remote ones get none (`apps/server/runner/spawn.ts:130`) | Its own tools. Later, calls back to a scoped set of Omni tools | No questions, html_render, thread reads or memory writes. Delegate-only roles refused |
| Approvals | The Questions card, for local agents (`CONTEXT.md:71`) | An approval event and a call that answers it | A status line, as Hermes today |
| Secrets | Only the harness's own key, as a header (`apps/server/runner/spawn.ts:134-141`) | Its own secrets | No change. Omni sends no other secret |
| Usage and cost | The `result` record carries tokens and model (`apps/server/stream.ts:30-45`) | Tokens per turn, cost when known, the serving model | Accounts says "not reported" |
| Worktree | The thread's data folder (`apps/server/sandbox.ts:52-55`) | Its own clone. Best if it takes repo, base and branch from Omni | No Changes tab, actions, snapshots, switch or continue |
| Attachments | Paths on the Mac (`apps/server/harness/hermes/adapter.ts:20-33`) | File parts in the message, or an upload call | Described as not transferred |
| Availability | A probe every 15 minutes (`apps/server/harness/catalog-service.ts:1`) | An authenticated health call that lists capabilities and models | Shown as unavailable in pickers |
| Concurrency | A cap per harness (`apps/server/config.ts:56-65`) | 429 when full | Omni's cap only |

#### A.2.1 Capability flags

Extend `HarnessCapabilities` (`apps/server/harness/types.ts:28-40`). Built-ins keep fixed values. A custom harness takes its values from the probe answer, and the user can turn a flag off but never on.

```ts
interface HarnessCapabilities {
  // today
  warmProcess: boolean;
  steer: boolean;
  interrupt: boolean;
  inlineImages: boolean;
  usage: 'five-hour-week' | 'monthly' | 'per-turn' | 'none'; // per-turn is new
  // new
  remote: boolean;                          // replaces PROVIDER_HARNESSES (types.ts:16)
  workspace: 'worktree' | 'own-clone' | 'none';
  git: 'local' | 'reports' | 'takes-branch' | 'none';
  omniTools: 'all' | 'scoped' | 'none';
  browser: boolean;
  toolLimits: boolean;                      // Omni can enforce delegate-only and no-edits
  approvals: boolean;                       // the remote asks, Omni's Questions card answers
  attachments: 'inline' | 'upload' | 'note';
  sessions: 'durable' | 'none';
  switchable: boolean;                      // handover to and from (switch-plan.ts:33-35)
}
```

| Harness | steer | interrupt | workspace | git | omniTools | toolLimits | usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | yes | yes | worktree | local | all | yes | five-hour-week |
| Codex | yes | yes | worktree | local | all | yes | five-hour-week |
| Cursor Agent | no | no | worktree | local | all | yes | monthly |
| Hermes | yes | yes | own-clone | none | none | no | per-turn |
| Cursor Cloud | no | yes | own-clone | reports | none | no | none |

#### A.2.2 Wire protocol: Runs API v1

Document the HTTP shape Omni already speaks to Hermes as Omni's remote harness protocol, in a new `docs/internals/remote-harness-protocol.md`. Hermes keeps working unchanged. Each addition is optional, and the probe answer says which ones a server supports.

| Call | Today, with Hermes | Addition |
| --- | --- | --- |
| `GET /v1/capabilities` | 200 means up. Omni throws the body away (`apps/server/harness/hermes/client.ts:83`) | Body: protocol version, the flags above, models, model family |
| `POST /v1/runs` | `input`, `session_id`, `instructions`, `Idempotency-Key` | `git: {repo, base, branch}`, `files`, and `tools: {url, token}` once scoped tools exist |
| `GET /v1/runs/{id}/events` | SSE with `seq` | `artifact.created`, `git.pushed`, and `usage` with `cost_usd` on the terminal event |
| `GET /v1/runs/{id}` | Status after a dropped stream | No change |
| `POST /v1/runs/{id}/steer` | 409 once the run ended | No change |
| `POST /v1/runs/{id}/stop` | Cancels the run | No change |
| `POST /v1/runs/{id}/approval` | Exists, unused | Answers from the Questions card |

Why our own protocol first, and A2A second:

- Omni already speaks this one, with tests, retries on one key, steer, reconnect and approval events.
- A shim on eve or Cloudflare is one route file on their side (A.3.2, A.3.3).
- A2A has no usage and no tool-call events (A.3.4), so an A2A thread shows less than a Hermes thread does.

### A.3 Per-target fit

#### A.3.1 Hermes Agent on a VPS

- **Works today.** Everything in A.1, on one server over Tailscale.
- **Works after B1.** Several servers, each a custom harness with its own key, cap and URL, with HTTPS for a server outside the tailnet.
- **Degrades.** No worktree, browser, artifacts folder or Omni tools. Attachments are only described. No switch or continue. Delegate-only roles are refused. No PR link until B3, no spend totals until B4.
- **Trust and security.**
  - Hermes runs its own tools with its own secrets on the VPS, and Omni cannot take tools away there (`apps/server/crew.ts:58-63`). A role's `tools: no-edits` or `browser: false` is only prompt text on Hermes.
  - The bearer token travels over plain HTTP today; the documented URL is `http://100.x.y.z:8642` (`apps/server/config.ts:61`). WireGuard encrypts that on a tailnet. On a public VPS address it needs HTTPS, so B1 refuses `http://` unless the host is on the tailnet or localhost.
  - A VPS is easier to break into than a Mac on a home network. Whoever controls it controls the text that reaches the Conductor (A.5).
- Hermes Agent also speaks ACP (https://agentclientprotocol.com/get-started/agents.md, https://hermes-agent.nousresearch.com/docs/user-guide/features/acp). ACP's remote transport is still a draft, so the Runs API stays the way in (A.3.4).

#### A.3.2 Vercel eve

What the docs say:

- A deployed eve agent serves its own HTTP API under `/eve/v1`: create a session, send a follow-up, `cancel`, `end`, `GET .../stream`, `health` and `info`. https://eve.dev/docs/channels/eve
- The server assigns session ids. `operationId` makes a create safe to retry and `idempotencyKey` does the same for follow-ups. Unknown top-level fields get a 400. https://eve.dev/docs/channels/eve
- Each session is a durable workflow that survives restarts and redeploys. https://eve.dev/docs/concepts/execution-model-and-durability
- The stream is NDJSON with a `startIndex` cursor for reconnects. Events include `turn.*`, `call.*` for tools, agents and skills, and `usage.recorded` with tokens and `costUsd`. https://eve.dev/docs/concepts/sessions-runs-and-streaming
- A follow-up during a turn steers it by default, but only from the turn's own caller; other callers' messages queue. Cancel takes a `turnId` guard. https://eve.dev/docs/concepts/sessions-runs-and-streaming
- Approvals pause the turn. The client answers with `answers: [{interactionId, optionId}]`. https://eve.dev/docs/human-in-the-loop
- There is no per-call instructions field. `clientContext` adds context to one turn and is not saved to history. https://eve.dev/docs/guides/client/messages
- Auth fails closed: production traffic is rejected unless an authenticator accepts it, such as Vercel OIDC, HTTP Basic, a JWT or a custom function. https://eve.dev/docs/guides/auth-and-route-protection
- Each session gets a Vercel Sandbox. Private clones go through credential brokering, and `git__pr` opens a draft PR. https://eve.dev/docs/sandbox/vercel, https://eve.dev/docs/concepts/security-model, https://eve.dev/docs/code-extension
- Secrets live in the app runtime's `process.env`, never in the sandbox. The docs show no per-call secrets. https://eve.dev/docs/concepts/security-model
- eve also serves A2A 1.0 (`/.well-known/agent-card.json`, `POST /eve/v1/a2a`) and an MCP channel with `agent_start`, `agent_get`, `agent_update` and `agent_cancel`. https://eve.dev/docs/channels/a2a, https://eve.dev/docs/channels/mcp

Fit:

- **Works.** Start, stream with a cursor, steer, cancel, durable resume, approvals, tokens with cost, and PRs from its sandbox. Of the three targets, eve matches Omni's thread model most closely.
- **Degrades.** Omni's charter cannot go as a system prompt. It goes in `clientContext` every turn, which costs tokens each turn, or once in the first message, which compaction can drop. The agent's own `instructions.md` stays in charge. No Omni tools, browser or worktree. The model picker shows one entry, the agent's.
- **Adapter.** B6 reaches eve through its A2A channel with no eve code. A native `eve` kind maps cleanly too: NDJSON with a cursor, and a server-assigned id stored through `cb.session`. Build it only if the A2A path loses too much (B7).
- **Trust and security.**
  - Ben has to add an authenticator Omni can pass, such as HTTP Basic or an HMAC JWT. `eve init` scaffolds a `placeholderAuth()` that must be replaced (https://eve.dev/docs/guides/auth-and-route-protection). Omni stores the secret by name.
  - Steering works only when every Omni message for a thread comes from the same caller. One secret per harness gives that.
  - The agent runs on Vercel with its own env secrets and connections, and Omni cannot see what it can reach.
  - eve's A2A docs warn that a public agent makes context and task ids bearer capabilities (https://eve.dev/docs/channels/a2a). Omni refuses an eve or A2A harness with no auth.
  - It bills AI Gateway on Ben's Vercel team, not his plans.

#### A.3.3 Cloudflare Agents

What the docs say:

- An agent is a class on a Durable Object. Each name is one instance with its own state and SQLite, served at `/agents/{binding}/{name}`. Clients use `AgentClient` over WebSocket, or plain HTTP to the agent's `onRequest`. https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/
- `AIChatAgent` chat runs over WebSocket with Cloudflare's `CF_AGENT_*` messages. It saves messages, resumes a stream after a reconnect and cancels with `CF_AGENT_CHAT_REQUEST_CANCEL`. Overlapping messages are queued, replaced, merged, dropped or debounced (`messageConcurrency`). It has no steering. https://developers.cloudflare.com/agents/agent-class/communication-channels/chat/chat-agents/
- The experimental harnesses differ. Pi and OpenCode take `submit` with an `operationId`, `steer` and `abort(operationId)`. The Claude Code and Codex harnesses run the CLI in a Container and document no interrupt. https://developers.cloudflare.com/agents/harnesses/pi/, https://developers.cloudflare.com/agents/harnesses/opencode/, https://developers.cloudflare.com/agents/harnesses/claude-code/
- Auth is the author's code, in `onBeforeConnect` and `onBeforeRequest`. https://developers.cloudflare.com/agents/runtime/routing/authentication/
- Secrets are per Worker. The docs show no per-request secrets. https://developers.cloudflare.com/workers/configuration/secrets/
- `AIChatAgent` has no usage API. AI Gateway analytics show tokens and an estimated cost. https://developers.cloudflare.com/ai-gateway/observability/analytics/
- The Sandbox guide for private repos blocks `git push` on purpose. https://developers.cloudflare.com/sandbox/network/clone-a-private-repository/
- The Agents docs do not mention A2A.

Fit:

- **Works.** Durable sessions by instance name (`omni-<thread id>`), streaming with resume, cancel. A Pi or OpenCode harness adds steer and abort.
- **Degrades.** No standard wire protocol. Every Cloudflare agent is the author's own code, and chat is a WebSocket with Cloudflare's message set, which the Omni server would hold open per thread. No usage per turn unless the agent reports it. PRs need the author to set up push credentials.
- **Adapter.** Skip a native adapter. Ship a Worker template that serves the Runs API from `onRequest` and calls the agent by name (B7). Swap to A2A if Cloudflare ships it.
- **Trust and security.**
  - Auth is whatever the author writes. A Worker with no `onBeforeRequest` check is open to anyone who guesses an instance name. Omni's names are random UUIDs, but B1 refuses an entry with no auth secret anyway.
  - Secrets sit in the Worker. Omni never sends any.
  - It bills the author's Cloudflare account.

#### A.3.4 Generic endpoint: A2A, MCP and ACP

A2A:

- The current release is 1.0.1 (https://github.com/a2aproject/A2A/releases). Clients find an agent through its card at `/.well-known/agent-card.json`. Bindings are JSON-RPC, gRPC and REST. `SendStreamingMessage` streams over SSE, and `CancelTask` and `SubscribeToTask` exist. `contextId` is the conversation and `taskId` one unit of work. Parts carry text, bytes, URLs or JSON. The card declares auth schemes. https://a2a-protocol.org/latest/specification/
- Steering: "Agents MAY accept additional messages for tasks in non-terminal states", and the card has no flag that says whether one does. https://a2a-protocol.org/latest/specification/#333-asynchronous-processing
- Usage: the core spec has none, only free-form `metadata`. https://a2a-protocol.org/latest/specification/#411-task
- Reconnect: `SubscribeToTask` returns the task, then live events. There is no cursor to replay what was missed. https://a2a-protocol.org/latest/specification/#316-subscribe-to-task
- Cards can be signed with JWS, and clients SHOULD verify a signature. https://a2a-protocol.org/latest/specification/#843-signature-verification

A2A fit:

- **Works.** Start, stream, cancel, resume by `contextId`, artifacts.
- **Degrades.** Omni tries a steer and queues it when the agent refuses. There are no tool-call rows unless an extension adds them, so the transcript shows text and status. Usage appears only when the agent puts it in metadata. Events missed during a reconnect are lost; the task snapshot still gives the final state.
- **Trust and security.** The endpoint can be anyone's server. Card fields such as name and skills are untrusted text that the UI shows and `list_harnesses` hands the Conductor. Omni verifies a signed card when there is one. It never follows a URL from a card to a private address unless the user typed that address, which guards against SSRF.

MCP is a poor transport for driving a run. The current revision, 2026-07-28, moved tasks into an extension, made the protocol stateless and removed SSE resumability (https://modelcontextprotocol.io/specification/2026-07-28/changelog). A client cannot send a new message into a running task on its own initiative. Omni keeps MCP for tools.

ACP fits the thread model best: prompt, cancel, and session updates with tool calls and cost (https://agentclientprotocol.com/protocol/v1/prompt-turn.md). Claude Code and Codex speak it through adapters, and Hermes Agent speaks it directly (https://agentclientprotocol.com/get-started/agents.md). Its only standard transport is stdio, and the remote transport is a draft RFD (https://agentclientprotocol.com/protocol/v2/transports.md). If that ships, ACP could replace the Runs API; that is E2.

### A.4 Binding to the role data model

Two files. The harness file says where and how a thread runs. The role file says who does the work. One key rotation then covers every role on that harness.

```yaml
# data/harnesses/hermes-hetzner.yaml     id: custom:hermes-hetzner
name: Hermes on Hetzner
kind: runs-api                 # runs-api (B1) | a2a (B6) | eve (B7, only if needed)
url: https://hermes.tail1234.ts.net:8642
auth:
  scheme: bearer               # bearer | basic | header
  secret: HERMES_HETZNER_KEY   # a secret store name. The value never enters this file or sync
bills: Anthropic API key on the VPS   # shown in pickers, like "Claude plan"
family: anthropic              # model family for review_of. Omitted means unknown
cap: 4                         # concurrency, like OMNI_MAX_CONCURRENT_HERMES
capabilities:                  # turns flags off. Cannot turn on what the probe did not report
  steer: false
git: takes-branch              # none | reports | takes-branch
tools: none                    # none | scoped (B5)
```

Rules for harness files:

- **Ids** are `custom:<slug>`, so they never clash with built-ins. The thread table's `harness` column is free text (`apps/server/db/migrate.ts:42`), so it stores them as they are.
- **Hermes keeps its id.** The current URL and `HERMES_API_KEY` become the first `runs-api` entry with id `hermes`, so existing threads keep running (E4).
- **A missing harness refuses.** A thread whose harness file is gone shows the id and refuses to run. That replaces the Claude Code fallback at `apps/server/runner/state.ts:31`.
- **Sync** works like crew files in S2: a signed action entity. Secret values stay in each machine's secret store. A machine without the secret shows the harness as unavailable and names the secret. `set_secret` can send it there sealed to that machine's key (`docs/user/sync.md:49`).
- **Probe** on save and every 15 minutes, as Hermes does now.
- **Network.** `http://` only on the tailnet or localhost. Redirects stay unfollowed (`apps/server/harness/hermes/client.ts:81`, `:115`). An entry with no auth secret is refused.

Role fields, added to plan section 2.2:

```yaml
harness: custom:hermes-hetzner   # today's field, which now takes custom ids
model: default                   # from the harness's probe answer
remote:                          # only for a custom harness
  agent: researcher              # which agent on the endpoint, such as a Cloudflare binding or an A2A skill. Omit for one-agent endpoints such as eve and Hermes
  session: per-thread            # per-thread (default) | per-role: one long conversation for every thread of the role
  charter: instructions          # instructions (default) | first-message | every-turn (eve's clientContext)
```

What each role setting needs from its harness:

| Role setting | Needs | On a harness without it |
| --- | --- | --- |
| `tools: delegate-only`, `mcp: [omni]` | `omniTools: all` and `toolLimits` | Refused on save and at thread create, as today (`apps/server/runner/api.ts:148`) |
| `tools: no-edits` | `toolLimits` | Saved with a "prompt only on this harness" warning |
| `review: true` | `toolLimits` and a known `family` | Saved with a warning. `review_of` never counts an unknown family as the other family |
| `browser: true` | `browser` | Ignored, and the editor says so |
| `connections.mcp`, `connections.secrets`, `connections.skills` | A local harness | Not sent. The editor says the remote agent uses its own |
| `memory: read` | Nothing | Sent as text with the charter |
| `memory: read-write` | `omniTools: scoped` | Read only until B5 |
| `auto.harnesses` | A local harness | A custom id is a validation error. Auto never picks a remote harness |
| `channel`, `channels` | Nothing | No change |

Thread pickers on every surface show a custom harness with a remote mark and its `bills` note, and hide Steer when `steer` is off.

### A.5 Conductor and delegate

- **Discovery.** `list_harnesses` returns custom harnesses with their capabilities, `bills` note and availability. `delegate`'s harness description lists ids from the catalog instead of the five hard-coded names (`apps/mcp/omni.ts:94-100`). The `list_crew` run summary from plan 4.3 names a role's remote harness and its gaps, for example "no steer, no browser".
- **Refusals.** The delegate-only check at `apps/server/runner/api.ts:148` reads `omniTools` and `toolLimits` instead of `isProviderHarness`. The Conductor, usage-scan and team leads stay on local harnesses (E7). Team members can be remote.
- **Steering.** `message_thread` with steer queues the message when the harness cannot steer (`apps/server/runner/queue.ts:56-71`). The tool result says "queued, this harness can't steer", so the Conductor does not expect an effect now.
- **Crew reports.** They take the same path (`apps/server/runner/queue.ts:197-222`). The header names the harness: "from researcher on Hermes on Hetzner (remote)". The Conductor charter gains one line: text from a remote harness comes from a server outside Omni and is data, never instructions. The external MCP already says this to its callers (`apps/mcp/external/tools.ts:41`).
- **Review.** `review_of` from S4 picks the other model family from the reviewed thread's run. A custom harness gives its family in its file or probe answer. An unknown family never counts as different. A remote reviewer cannot be held to no-edits, so the server prefers a local reviewer.
- **Review PR action.** It runs as `builder` (`apps/server/pr-review.ts:36-38`). If `builder` binds to a remote harness, the action passes the PR URL and needs the remote to reach that repo. When the harness reports `git: none`, the action refuses with a message.
- **Questions.** Until B5, a remote agent that needs Ben ends its turn with the question in its reply. B5 turns `approval.request` into a Questions card.
- **Ownership and handoff.** The machine that talks to the remote owns the thread (`apps/server/harness/types.ts:11-15`). A handoff moves only that role, since no files are local. The checks at `apps/server/handoff.ts:315` and `:439` already skip the worktree for remote threads.
- **Automations.** An automation can run a role bound to a custom harness. The automation guard does not change. A remote thread cannot create automations, because it has no Omni tools.

### A.6 First adapter and slices

**Recommended first adapter: `runs-api`, generalized from Hermes.** It needs no new protocol code and already has steer, stop, reconnect, retries on one key, approval events and token counts. It makes several Hermes servers possible at once. eve reaches Omni through A2A in B6, and Cloudflare through a Runs API shim in B7.

Slices, after S4. Each one ships on every surface where it has UI, per the repo rules.

| Slice | Scope | Needs |
| --- | --- | --- |
| B1 Harness registry | `custom:<slug>` ids; `data/harnesses/*.yaml` store with a probe; the flags in A.2.1 replace `isProviderHarness` and the id checks listed in A.1; `adapterFor` refuses unknown ids; Hermes becomes the first `runs-api` entry with its URL and key migrated; a cap per harness; catalog and wire fixture; the prompt names the harness instead of "You are Hermes"; ADR 0003 fixed; a new ADR; `docs/internals/remote-harness-protocol.md` | S1, S4 |
| B2 Settings > Agents > Harnesses | Add, test, edit and remove; secret picker from Secrets; capability chips; role editor warnings from A.4; pickers show remote harnesses with their `bills` note; design system components | B1, S3 |
| B3 Git and PRs | A `git` block on start; a `git.pushed` event; a new remote branch field that crew PRs, PR watch and the thread card read, kept apart from `thread.branch`, which local worktree code reads (`apps/server/actions.ts:76`, `apps/server/runner/snapshots.ts:60`); the repo must match the channel's `github_repo`; Cursor Cloud's reported branch goes there too | B1 |
| B4 Spend | Per-turn tokens and cost added up per thread and per harness; Accounts and Overview rows for remote harnesses | B1 |
| B5 Scoped tools and approvals | A per-thread token for that thread only, limited to ask, render, thread reads and remember, revoked when the thread ends; Omni's MCP reachable from the remote over the tailnet or the existing tunnel; `approval.request` becomes a Questions card answered through `/approval` | B1, S6 for remember |
| B6 A2A adapter | `kind: a2a`: card discovery and signature check, `SendStreamingMessage`, `CancelTask`, `SubscribeToTask`, `contextId` as the session; steer tried, queued on refusal; usage from metadata when present. Covers eve through its A2A channel | B1 |
| B7 Shims | Templates that serve the Runs API from an eve custom channel and from a Cloudflare Worker's `onRequest`, documented in `docs/user/harnesses.md`; a native `eve` kind only if B6 loses too much | B1, B6 |
| B8 iOS | Harness list, picker marks and capability-gated Steer through `@omni/client-core` | B2, S8 |

B1 alone gives Ben several Hermes servers and roles bound to them. B2 to B4 make remote threads show their PRs and spend like local ones. B5 is the security-heavy slice, so it comes after the rest of the core. B6 and B7 add the other targets.

### A.7 Open decisions for Ben

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| E1 | UI name | "Custom harness" in the Harnesses list, or "Remote agents" | Custom harness |
| E2 | First wire protocol | Runs API (Hermes shape), A2A, or ACP | Runs API first, A2A second, ACP once its remote transport ships |
| E3 | Where harness files live | Synced files in `data/harnesses/`, or per-machine config | Synced signed files, secret values per machine |
| E4 | Existing Hermes | Keep id `hermes` as the first entry, or rename to `custom:hermes` | Keep `hermes` |
| E5 | Remote branches | Omni names the branch, or the agent picks and reports it | Omni names it when the harness takes one, otherwise the agent reports it. Both are checked against the channel repo |
| E6 | Omni tools for remote agents | None, a scoped per-thread token, or the install token | None until B5, then scoped. Never the install token |
| E7 | Delegating from a remote harness | Never, or once scoped tools exist | Never in this plan |
| E8 | Endpoints off the tailnet | Tailnet only, HTTPS allowed, or anything | Tailnet or HTTPS |
| E9 | Role secrets to a remote | Never, or the role's allowlist over HTTPS | Never |
| E10 | Charter delivery | Instructions field, first message, or every turn | Instructions where the remote takes them, otherwise the first message. Every turn only when the role asks |

Why:

- **E1**: the glossary already says harness for "where a thread runs" and avoids "agent" for crew roles (`CONTEXT.md:24-26`, `:100-102`). A second meaning of "agent" in Settings would clash with D1.
- **E2**: Omni already speaks the Runs API with tests. A2A lacks usage and tool-call events. ACP has both but only on stdio today.
- **E3**: the same reasons as D2, and a key rotation then touches one file. Secret values do not sync on their own; `set_secret` sends one sealed to a trusted machine (`docs/user/sync.md:49`).
- **E4**: threads store the harness id, so a rename would need a data migration for no gain.
- **E5**: a branch Omni names is known before the run starts, so crew PRs work without trusting a remote's report. Agents that pick their own branch, such as Cursor Cloud and eve's `git__pr`, still report one.
- **E6**: the install token opens every `/api` route (`apps/server/api-token.ts:1-3`). Anyone holding the external MCP URL can start threads on Ben's machine (`docs/user/external-mcp.md:23`), and those run with full permissions (`apps/mcp/external/tools.ts:40`). A server outside Ben's machine should hold neither.
- **E7**: a delegating remote agent could start local threads with full permissions on Ben's Mac, and Omni cannot limit its own tools (`apps/server/crew.ts:58-63`).
- **E8**: a Bearer token over plain HTTP is readable on the open internet. The tailnet encrypts it, and HTTPS does elsewhere.
- **E9**: eve and Cloudflare both keep secrets in the agent's own runtime (https://eve.dev/docs/concepts/security-model, https://developers.cloudflare.com/workers/configuration/secrets/). Sending Omni's would copy them to a server Omni does not control.
- **E10**: Hermes takes `instructions` (`apps/server/harness/hermes/adapter.ts:179-190`). eve has no such field, and `clientContext` costs tokens on every turn (https://eve.dev/docs/guides/client/messages).
