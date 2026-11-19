# User-defined crew roles

A plan for letting Omni users create and edit their own crew roles (Ben's "agent types"), each with its own instructions, run defaults, memory, connections and permissions, instead of the seven files that ship in `crew/`.

- Status: approved 2026-11-18. Ben took the recommendation for every decision, D1 to D11, as written (section 7). S0 to S4 and S7's first part are merged; S5 (no-edits) and S6 (role memory) are being built (T-CREW-S5S6). Task T-AGENTS.
- Surveyed: `main` at `9e087e5a` (desktop 0.1.35). Every claim about current behavior cites `path:line` on that commit.
- Wording: the glossary calls these **crew roles** and asks to avoid "agent" (`CONTEXT.md:24-26`). This plan follows it. What the UI calls them is open decision D1.

## Summary

- A crew role today is a markdown file with YAML frontmatter. Shipped ones live in `crew/`, and a file with the same name in `data/crew/` replaces the shipped one whole. Omni reads them from disk on every lookup. There is no UI, no sync and no memory.
- Four role ids are wired into code: `conductor`, `reviewer`, `usage-scan` and `builder`. The reviewer's cross-family rule lives only in the Conductor's charter text.
- Proposal: keep files as the source of truth and copy the automation editor's model (shipped, edited, own, reset, synced as a signed action). Edits to a built-in become an overlay, so release fixes to its charter still arrive. Special behavior moves from id checks to capability flags and server-side rules.
- Memory: an Omni-owned memory folder per role, injected into every harness's prompt. Writes go through a tool and wait for Ben's approval by default.
- A role is a definition (charter, memory, connections, run defaults) plus a runtime binding. The binding stays open to agents Omni does not run itself (section 2.5).
- Nine slices (S0 to S8) below. Eleven decisions, all settled, at the end.

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

The shipped charters name Ben's setup: the Ask Phill Portal (`crew/researcher.md:8`), the APA skills (`crew/builder.md:10`), Productive (`crew/inbox.md:3`, `:7`) and a Shopify-only role (`crew/store-ops.md`). `crew/` ships through the same `SHIPPED_DIRS` (`apps/desktop/scripts/stage.ts:27`) that carried Ben's automations into the public release. T-5E55 fixed that for `automations/` in #791, which ships none and guards it in `apps/desktop/tests/stage.test.ts`. Slice S0 does the same for `crew/`.

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
- **The release carries no one's personal roles** (S0): shipped charters hold only generic text and `{{placeholders}}`. A stage-time check fails the build when `crew/` names a user, company or client, the same kind of guard #791 added for `automations/`. Ben's own roles move to his `data/crew/` and reach his other machines through sync (S2).

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

### 2.5 Runtime binding: the extension point for outside agents

Users will want to bring their own agents: a Hermes agent on a VPS, a Vercel eve agent, a Cloudflare agent. None of that is built in this plan, but the role schema must not block it.

- **A role is a definition plus a binding.** The definition is the charter, memory, connections and powers. The binding is `harness` (with `model` and `effort`): which runtime runs the role's threads. Today every runtime is a harness adapter in `apps/server/harness/`, reached through `HarnessSession` (`apps/server/harness/adapter.ts:101`).
- **Hermes is the reference case.** It is already a remote agent: an HTTP API on another machine with no process, its own keys and no Omni worktree (`apps/server/harness/hermes/adapter.ts:1-6`). What it cannot do (per-run tool limits, delegate-only, Keychain secrets) is a fact about the runtime in section 2.4's table, not a field on the role. An outside agent fits the same shape.
- **Where the extension sits.** An outside agent becomes a runtime entry, not a new role field: Settings gets a runtime registry (id, protocol, endpoint, and an auth secret by name, never its value), and each entry joins the harness catalog under its id. A role binds to it the way it binds to Hermes now, with `harness: <runtime id>`. One VPS agent can then serve several roles, and its secret stays in the secret store. A `runtime:` key in the frontmatter is reserved for anything that has to be per role later (say, a different endpoint path per role).
- **What S0 and S1 do so that needs no schema break:**
  - `harness` stays an open string in role files and in the wire types (`apps/server/crew.ts`, `packages/client-core/src/api/crew.ts`, `apps/web/src/api.ts`). No enum of harness ids.
  - The crew store checks `harness` against the harness catalog this machine has, not a fixed list, and only when a role is saved. A role whose harness this machine lacks still loads, with an `error` on it, the way a retired model shows today (`apps/server/meta-api.ts:30`).
  - The store keeps frontmatter keys it does not know when it edits a file, so a `runtime:` block written by a later build survives an edit from an older one.
- **What the runtime slice changes later.** Harness ids are a closed list today: `HarnessId` and `HARNESS_IDS` (`apps/server/harness/types.ts:7-9`), checked by `isHarnessId` in the resolver (`apps/server/harness/resolve.ts:44-45`, `:93`). That list becomes the built-in adapters plus the registry's entries. The role files and the crew store do not change.

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
- **Ben's personal content** moves from `crew/` to his `data/crew/` in S0, and S2 syncs it to his other machines. As built: S0 drops it from `crew/` and hands Ben his four files (builder, researcher, inbox, store-ops) to drop into `data/crew/` on each machine before he installs a release with S0. Agents never write the live install's `data/`, so S0 cannot place them itself.

### 6.2 Slices

Ordered. Each slice ships on all three surfaces where it has UI, per the repo rules.

| Slice | Scope | Needs |
| --- | --- | --- |
| S0 Release hygiene | Generic shipped charters; Ben's roles move to his `data/crew/`; stage-time guard on `crew/` | #791's automations guard (merged), to share its check |
| S1 Store and API | Crew store module, overlay merge, `based_on`, shipped/edited/own, hide, CRUD and reset routes, refuse unknown ids on create, `delegatable` in `list_crew`, wire fixture, `docs/user/crew.md` | none |
| S2 Sync and guard | `crew_file` signed action entity with last-writer-wins handler, sync backfill label, guard for agent writes | S1 |
| S3 Settings > Crew | List, Form and Markdown editor, duplicate, delete, hide, reset, compare; avatars; design system components | S1 |
| S4 Capabilities | `review` flag in `reviewerEffort`, reserved ids and locked fields, `review_of` on `delegate`, Conductor charter trimmed | S1 |
| S5 Powers and connections | `tools: no-edits`, `browser`, `channels`, secrets allowlist and `crew:<id>` scope, MCP registry and per-role servers, role skills plugin dir, `auto.harnesses` | S1; UI in S3 |
| S6 Role memory | Memory store, prompt injection, `remember` tool (Rust threads server and conductor tools), approval queue, synced entity | S1, S2, S3 |
| S7 Conductor tools | `get_crew_role`, `save_crew_role`, `reset_crew_role`, `crew_memory`, external MCP fields, charter update | S1, S2, S4 |
| S8 iOS | Settings > Crew list and editor through `@omni/client-core` | S1, S3 |

S1 to S4 give a usable feature: roles you can create, edit, sync and trust. S5 to S8 deepen it.

### 6.3 Where the build differs from this plan

- **S1 refuses every agent write.** `/api/crew` writes that carry `x-omni-thread` get a 403, instead of waiting for S2's guard. S1 opens a write path to a prompt every later thread runs with, and nothing needs an agent to write roles before the Conductor's tools (S7) and their guard exist. S2 and S7 replace the blanket refusal with the guard's rules.
- **S1 keeps the routers routing.** A save that drops `delegate_only` or the `omni` MCP server from the conductor or usage-scan is refused, and neither can be hidden. Section 5 put locked fields in S4, but the API that could unlock them ships in S1. The rest of S4's locks (charter Add-only, no duplicate) stay in S4.
- **S1 also makes `delegate` refuse a non-delegatable role** (section 4.3), since the flag that `list_crew` reads would otherwise only hide the role, not stop it. Server-side: a thread the Conductor or a team starts may only take a delegatable role.
- **`GET /api/crew` leaves hidden roles out unless asked (`?all=1`),** so the composer pickers and `list_crew` drop them with no client change. Settings (S3) asks for all.
- **The external MCP's `list_crew` keeps the conductor,** which is not delegatable but which an outside client may start a thread as. It drops hidden roles and usage-scan.
- **`crew` in the user config is optional on the wire** (`packages/shared/settings.ts`), so a newer client reads an older server's config.
- **S2's guard opens saves and resets only, and only to the Conductor.** D10 names the Conductor, so the guard (`apps/server/crew-guard.ts`) lets an agent save or reset only from a thread running as the reserved `conductor` id, never under an automation or in a usage scan, and only once Ben answered in that thread after its first message (or answered a question it asked). It keys on the id, not on holding the conductor tools, since a save could hand those to another role. An agent's save also leaves powers alone (`mcp`, `delegate_only`, `delegatable`) and cannot send whole-file markdown, which could set them. The guard cannot read agreement; D10's "after Ben agrees" becomes "after Ben spoke", the same test the usage scan's save takes. Delete, hide and show stay Ben's: no planned tool makes them. Until S7 adds the tools, no agent has a way to reach the open path, since the Conductor has no shell.
- **S2 stops agents speaking as Ben.** The message, published-comments and compact routes recorded an agent thread's call as Ben's message by default, and the Conductor's `check_artifact_comments` tool can name its own thread, so it could have answered for him. A call that names its thread (`x-omni-thread`) is now always the Conductor's, and an agent thread cannot answer a question card. That closes the same hole in the usage scan's guard.
- **S2 sends the files written by hand once.** Section 6.1 has S2 carry Ben's roles to his other machines, but a save-only entity would never send a file dropped in `data/crew/` by hand. The first sync after this build queues each one at `SEED_TS`, and the handler never lets such a seed replace a file the receiving machine has. Hand edits after that stay on their machine until a save in Omni, as automation files do.
- **S2's guard refuses an agent's reset that would change a role's powers.** A reset drops the whole overlay, so on a role whose overlay sets `mcp`, `delegate_only` or `delegatable` it would undo what Ben set. It holds those to the same rule as an agent's save, and Ben resets such a role himself.
- **S2 keeps every message an agent sends from counting as Ben's.** Besides the message, comments and compact routes, the review notes an agent thread sends are recorded as the Conductor's, and a thread moving to another machine carries each queued message's sender (`senders` on the handoff offer), so a message an agent queued never lands as Ben's there. An offer from an older build names no senders and stays Ben's.
- **S2's sync backfill carries crew files too.** Relay recovery (`npm run sync:backfill`) queues each file in `data/crew/` again at the time Omni last saved it, and a file written by hand at `SEED_TS`, so a relay that lost history gets them back without any one replacing a newer file elsewhere.
- **S2 adds a `crew` feed event,** published on every save, reset, delete, hide and synced file, so open Settings and pickers refetch `GET /api/crew` (S3).
- **S3's avatar is the channel avatar model without the SVG upload.** Section 2.2 sketched `avatar: { icon: cart, bg: amber }`. As built, `icon` takes the channel encoding (`icon:<name>` from the shared set, or one emoji) and `bg` a hex color, so the editor reuses the channel `IconPicker` and `AvatarColorPicker`. An uploaded SVG would not read in a markdown file, so roles leave it out.
- **S3 duplicates on the server** (`POST /api/crew/:id/duplicate`), not by the client posting a copy, so S4 can refuse a duplicate of the singletons in one place. An agent may not duplicate: a copy carries the role's powers.
- **S3's composer pickers keep the Conductor.** Section 4.1 hides every `delegatable: false` role from the pickers. The Conductor is one, but the composer attaches it in #conductor, so it stays; usage-scan goes.
- **S3 leaves iOS out of the Crew section until S8.** The catalog gains `crew`, and iOS draws its Settings from the catalog, so the app filters that section (and its search entry) out rather than show an empty screen.
- **S3 adds to `GET /api/crew/:id`:** the built-in alone (`builtIn`), so the form can send a field set back to the built-in's value as empty and let the overlay drop it, and the charters as written (`charters.builtIn`, `own`, `effective`) for the editor and Compare. Empty for a string, null for a list or a switch, removes a key.
- **S3's locks, Connections, Memory and channel "Crew here" list wait for their slices** (S4, S5, S6). The form edits Identity, Instructions, Run, Where and Powers.
- **S3's design system work went into the repo's mirror** (`design-system/components/CrewRoleRow/`), not the Claude Design project: the Claude Design MCP was not connected in the session that built it. The row is composed of existing parts (`Avatar`, `CrewMark`, `Chip`, `IconPicker`, `AvatarColorPicker`, `Segmented`, `Toggle`, `InlineConfirm`). The live project needs the card synced with `/design-sync`.
- **A synced overlay whose built-in a machine lacks loads as a role of the user's own** there (an older build without that shipped file). Nothing is lost: the file is the same, and it reads as an overlay again once that machine has the built-in.
- **S4 keeps the locks in one table** (`CREW_LOCKS` in `apps/server/crew.ts`) and sends them with each role as `locks`: the fields a save may not change and the actions refused, each with its reason, so Settings shows why without knowing ids (and S8's iOS editor can too). S1's router check became two of those locks. The `mcp` lock compares the conductor tools (`omni` in the list), not the whole list, so S5's servers can join it.
- **S4 locks the Conductor's `delegatable: false` too.** Section 5 locks it for usage-scan only. A Conductor the Conductor could delegate to would start threads that route work back to it.
- **S4 refuses a role that only routes work on Hermes or Cursor Cloud when it is saved**, not only when a thread starts. That is section 5's "local harnesses only" for the Conductor and "run fields editable within local harnesses" for usage-scan, as one rule for every `delegate_only` role.
- **S4 pins the review runs.** As the charter named them: work Claude wrote is reviewed on Codex's `gpt-6.1-sol` at `high`, and other work on Claude Code's `claude-opus-5-5` at `xhigh` (Auto's top tier, `TIERS.max`). A catalog without the model, or a model without the effort, refuses the review (409) instead of running it on Codex's configured default or the nearest effort. A run the delegation names is kept when it is on the other family; an effort alone does not move the pinned run. Hermes counts as Claude, as the charter said.
- **S4's `review_of` is refused with a role that does not review, or a thread Omni does not have,** and is not stored on the thread: the run it picked is, and the brief links the PR. `delegate_team` and the external MCP do not take it (S7 covers the external MCP).
- **`review` is a power for the crew guard.** An agent's save may not set it, since it changes the run a role gets.
- **The reviewer stays hideable and duplicable.** Section 5 locks only its capability. Duplicating it is how to get a reviewer without the review rules, since a role of the user's own has no locks.
- **The reviewer's `tools: no-edits` (D11) waits for S5**, which adds the `tools` key. S4 adds only `review: true` to the shipped file.
- **Review PR checks Builder before asking GitHub**, so a hidden Builder gets "show it in Settings > Crew" instead of the role check's list of other roles.
- **S7 ships `get_crew_role`, `save_crew_role` and `reset_crew_role` first.** `crew_memory` waits for S6's memory store. The tools are in the Conductor's TypeScript server (`apps/mcp/omni.ts`): `crates/omni-mcp` has no Conductor tools, since that port is not scheduled (`docs/internals/rust-port.md`).
- **A role the Conductor creates names no power.** It reads as every role without one does: no `mcp`, not `delegate_only`, `delegatable`, no `review`. Delegatable is what makes it useful to the Conductor, and full working tools are what every crewmate has until S5 adds `tools: no-edits`. The guard already refuses a save that names a power, so the server needed no change.
- **`save_crew_role` passes keys past its listed fields to the API**, so a power the Conductor names gets the guard's refusal and its reason rather than being dropped from the save without a word.
- **The memory store came first, as channel learnings** (knowledge-work slice F2, `docs/plans/2026-11-18-knowledge-work-slices.md`). It is a synced `memories` table (`apps/server/db/repos/memories.ts`, a signed action entity), not files in `data/crew/<id>/memory/`: a fact has an optional `channel_id` and an optional `role`. Channel learnings are facts with a channel and no role. S6 adds role facts to the same table, the `remember` tool and the Memory tab; agents already only propose (`apps/server/memory-api.ts`).
- **The external MCP gets no crew writes in S7.** Its calls name no thread (`x-omni-thread`), so the guard would treat them as Ben's own and let them set powers. Its `list_crew` fields stay as S1 left them.
- **The Conductor's charter now applies the edits it proposes** with `save_crew_role` once Ben agrees, and proposes a new role when work keeps finding none.
- **S5 builds `tools: no-edits` only**, with the reviewer shipping it (D11). The rest of S5's row (`browser`, `channels`, the secrets allowlist and `crew:<id>` scope, the MCP registry, role skills, `auto.harnesses`) waits for a slice of its own: the brief for this build named the reviewer's no-edits mode alone.
- **No-edits on Codex declines file patches instead of using the read-only sandbox.** Section 2.4 named Codex's read-only sandbox, which also stops the network and every write a check makes, so a reviewer on Codex (the run for work Claude wrote, S4) could not `gh pr diff` or run the tests. As built, a no-edits thread runs on the channel's sandbox with `approvalPolicy: untrusted`: Codex asks before each patch and each command it does not know to be safe, Omni declines the patches and lets the commands run (a channel at Ask first still judges them). That is D11's "Bash kept", as on Claude Code and Cursor. A channel at Read only keeps its read-only sandbox.
- **`tools: delegate-only` means `delegate_only: true`, and either key makes a role delegate-only.** So an overlay's `tools: full` never lifts a built-in's `delegate_only: true`, and the Conductor's `delegate_only` lock drops both keys from a hand-written overlay that breaks it.
- **`tools` is a power for the crew guard**, beside `mcp`, `delegate_only`, `delegatable` and `review`: an agent's save may not set it. `list_crew` names `tools: no-edits` on a role that has it, and `get_crew_role` shows `tools` under `powers`.
- **The reviewer's `tools: no-edits` is not locked.** Section 5 locks only its `review` capability, so Ben can turn No file edits off or duplicate the role.

## 7. Decisions

Settled 2026-11-18: Ben took the recommendation for all eleven. For D11, the UI and docs say that no-edits is not read-only, since Bash stays.

| # | Decision | Options | Recommendation (decided) |
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
