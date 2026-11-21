# Crew and Conductor

Each agent is a file in `crew/*.md` with frontmatter and a charter. Omni reads them on every run. The shipped charters are generic and go to every install, so they name no person, company, client or tool of anyone's own. The desktop build fails when one does (`personalCrewProblems` in `apps/desktop/scripts/stage.ts`).

| Agent | For |
| --- | --- |
| conductor | Front agent in #conductor. Answers quick asks itself, routes real work to a crew thread |
| researcher | Research, audits, answers to client questions, HTML reports |
| writer | Drafts and edits writing in your voice: emails, posts, proposals, docs, summaries. Never sends or publishes |
| builder | Code in a repo channel, own worktree, opens PRs. |
| reviewer | Reviews a PR against its brief, from the spec and diff only. A review agent (`review: true`) with no file-edit tools (`tools: no-edits`), which is not read only: see [No file edits](#no-file-edits) |
| inbox | Admin: mail, calendar, time tracking, tasks, notes and chat drafts. Never sends on its own; Approve on a run's question card is the go-ahead for that draft |
| usage-scan | Leads Scan my usage in #inbox: turns the repeated asks Omni found into up to 3 suggested automations ([Automations](automations.md#scan-my-usage)). Omni starts it; not for delegation |

Your own agents live in `data/crew/`, which is never shipped and which a release never touches. A file there with a new name is an agent of your own. For example, an agent for hands-on store work:

```markdown
---
name: Store ops
description: Hands-on store work. Admin API, theme checks, translations, imports, PageSpeed, SEO, using the channel browser.
model: auto
---
You operate on client stores.

- Never write to a published theme or a live store unless the brief explicitly says so. When unsure, do a dry run and report.
- For performance and SEO work, report numbers before and after.
- End with: what changed, where, and how to undo it.
```

A file there with a shipped agent's name is your edit of that built-in, an overlay:

- It sets only the frontmatter fields it names. The rest, and any the next release changes, come from the shipped file.
- With `charter_mode: append` its body is added after the shipped charter, so a release's fixes to the charter still reach you. Omni writes new edits this way.
- With `charter_mode: replace`, or no `charter_mode` at all (a copy made before overlays), its body is the whole charter. Omni then records the shipped charter it was written against as `based_on`, and the agent shows `builtInChanged` once a release changes that charter, or when a hand copy never recorded it.
- Hiding a built-in is per machine (`crew` in `data/omni.config.json`): no new thread starts as it, and lists leave it out. The conductor and usage-scan cannot be hidden (see [Agents Omni relies on](#agents-omni-relies-on)).

`delegatable: false` keeps an agent out of the Conductor's `list_crew` and makes `delegate` and `delegate_team` refuse it. The conductor and usage-scan set it. Starting a thread as an agent no file has, or one hidden on this machine, is refused with the valid ids; it used to run with no charter.

`tools` sets the tools an agent's threads get: `full` (the default), `no-edits` or `delegate-only` (`delegate_only: true`, the older key, means the same and wins over `tools`). See [No file edits](#no-file-edits).

`access: read` or `access: ask` runs the agent's threads stricter than their channel's level, never looser ([Access levels](threads.md#access-levels)).

`tokens:` names the accounts the agent reaches through a token instead of their connector, each with the secret that holds it (`tokens: { notion: OMNI_NOTION_TOKEN }`). While that secret is set, the agent's threads do not wait for that account's connector at the [sign-in check](automations.md#sign-in-check). Omni's [Notion](notion.md) section tells a thread how to use `OMNI_NOTION_TOKEN`; for any other token, the charter has to. The shipped agents that do their own work set it for Notion. A map with an unknown account or a bad secret name is left out, so the agent waits as before.

`harness` is the agent's runtime binding: any local harness id this machine's catalog has, checked when the agent is saved. An agent whose harness this machine lacks still loads, with an error on it. `harness: hermes` or `harness: custom:<slug>` makes it a [remote agent](#remote-agents), which only a new agent's file can name. Omni keeps frontmatter keys it does not know when it edits a file.

## Settings > Agents

Settings > Agents, in the Assistant group, lists every agent this machine has, hidden ones included, on desktop web, phone web and the desktop app. Each row shows the agent's avatar, its chips (Built-in, Edited or Yours, then Hidden, Built-in charter changed, or Can't run here when its run defaults name a harness or model this machine lacks), its description and the run it defaults to. A row opens the agent as a page of its own (`#/settings/crew/<id>`): its name on top, then labelled groups: **Identity** (name, description and avatar), **Instructions** (its charter), **Run defaults** (harness, model, effort and default channel), **Permissions** (may the Conductor delegate to it, does it review work) and **Memory** (its lessons and the ones waiting for you), then **Advanced**, the one group folded shut: the tool switches (No file edits, Conductor tools, Only routes work), Edit as Markdown, Duplicate and Compare with built-in. Hide, Reset to built-in and Delete close the page. Save sits in a bar at the bottom of the page, which says when the page holds unsaved changes. The iOS app gets the section later; until then use phone web. Meanwhile the iOS app's Settings > Models lists the remote agents, read-only, with whether each is connected.

- **Add remote agent** connects an AI agent on a server of your own and makes it an agent here ([Remote agents](#remote-agents)).
- **New agent** makes an agent of your own: a name, an id (made from the name; it never changes), a description, an avatar, a charter, run defaults, a default channel and its powers. It opens on its page once made. Names are unique, ignoring case: a second Builder (or builder) is refused when you save it.
- **Edit** is the page's form, or the file under **Advanced > Edit as Markdown** (**Back to form** returns). On a built-in, the form writes your overlay: a field you set back to the built-in's value leaves the overlay, so a release sets it again, and your text is added to the built-in charter (Add to built-in) or replaces it (Replace). Markdown saves the file as written. The two are one draft: switching carries your edits across, and keys the form does not show stay in the file.
- **Avatar**: the Identity block at the top of the agent's page (and of New agent) is the one place to set it, on desktop web, phone web and the desktop app. Its big avatar is the live preview, with a 20px sample under it of how it reads on a reply in a thread, an 18px one as a rail row draws it, and, for a character, its six eye states side by side (idle, thinking, working, waiting, needs you, done), still. The big preview moves as an idle agent does in a thread, and pops when you pick another shape or color, unless Reduce motion is on. **Avatar** picks one source, and picking one replaces the others, so the preview is what shows: **Character** (its crew character, where every agent starts), **Emoji** (one emoji), **Icon** (one of the shared icons) or **Upload**. Under Character, **Shape** offers a Default tile (the shape its id picks) and the 16 crew shapes in their own colors; the arrow keys move through them. A built-in's own shape says Built-in, and a shape another agent shows names that agent, so you can keep your agents apart. The line under the preview says "Its crew character" for a built-in in its own shape and color, "A crew character from its id" for any other agent's default, or the shape and color you picked ("A fan in Peach"). Upload takes a photo or an SVG: a PNG, JPEG or WebP up to 2 MB fills the circle, cropped square from the center and scaled to 256px, kept inline in the file as `avatar: { image: "data:image/webp;base64,..." }`; a plain SVG up to 20 KB, checked as a channel's (no scripts, links or embedded content), is kept as `avatar: { icon: "svg:<svg ...>" }`. Every source but a photo takes the agent's **Color** under it: the 14 agent colors by name (Ink, Sky, Amber, Violet, Rose, Mint, Green, Sun, Lilac, Magenta, Azure, Aqua, Teal, Peach), the color well or a hex of your own, which shows as Custom. **Reset to auto** goes back to the color its shape is paired with. Character saves as `avatar: { shape: fan, bg: "#feb98b" }`, an icon as `avatar: { icon: icon:tool, bg: "#52cdfe" }`; for an SVG you can click a color in it to sample it. Nothing saves until **Save**: a photo picked then goes to `PUT /api/crew/:id/avatar`, and saving any other source removes an uploaded photo, so it never hides what the preview shows. Each source keeps what you gave it while you try another, the shape included. The file syncs to your other machines and the phone. The iOS app has no agent editing; use phone web. The avatar shows in the composer's Agent picker, the thread header, the quick-actions card, the phone's sub line and on every reply the agent writes ([Threads](threads.md#who-wrote-a-reply)).
- **Default avatar**: an agent with no photo and no icon shows its crew character ([ADR 0021](../adr/0021-crew-avatars.md)): one of 16 shapes bent from the Omni ring, filled with the agent's color, outlined in the text color of the theme, with two eyes and the logo's lean, and no disc behind it. The built-in agents have their own: the Conductor a circle in Ink with a satellite, Researcher a droplet in Sky, Builder a squircle in Amber, Reviewer a wide pill in Violet, Writer an arch in Rose, Admin a tray in Mint, Store ops a triangle in Green, Usage scan a tall pill in Sun and Hermes a pebble in Lilac. Any other agent gets one of seven spare shapes, each with its own color, picked from its id, so it looks the same on every machine and keeps its face when you rename it. A background color you picked fills the shape instead. Every size has its own drawing, from 16px (the smallest avatar anywhere) to 88px. Desktop web, phone web, the desktop app and the iOS app draw it.
- **Shared icons became characters**: the update that brought crew characters cleared every shared icon (`icon:<name>`) from your agents' files in `data/crew/`, once on each machine, so those agents now show their crew characters. It also removed the background color under such an icon unless it is one of the 14 agent colors, so the character takes its shape's own color (a Builder on orange now shows Amber). Every other key and the charter stayed as written, and with sync on the changed files went to your other machines. Emoji, SVG and photo avatars, a remote agent's offered photo included, were left alone. An icon you pick again in the Identity block stays.
- **Avatar shape**: the file can also name one of the 16 crew shapes ([ADR 0021](../adr/0021-crew-avatars.md)), as `avatar: { shape: droplet, bg: "#52cdfe" }`, with `bg` the agent's one color. Omni ignores a shape it does not know, so a file from a later build shows the default there, and keeps the key when it edits the file. Clearing the avatar removes the shape with the icon and color.
- **Duplicate** makes an agent of your own with everything the agent has now, its whole charter included. A copy of a built-in no longer changes with a release.
- **Compare with built-in** shows the built-in charter and yours line by line. When the built-in changed under a charter you replaced, it offers Keep mine, Add mine to the new one, or Take the new one.
- **Hide** and **Show** a built-in on this machine, **Reset to built-in** drops your overlay, and **Delete** removes an agent of your own.
- **Powers**: whether the Conductor may delegate to it, the conductor tools, whether it only routes work, whether it has no file edits (`tools: no-edits`) and whether it reviews work (`review: true`). A field or action the agent cannot change shows a lock and why.
- **Memory**: whether its threads read its lessons and propose new ones, and whether what they propose waits for you. The editor's **Memory** tab lists the lessons, with a count of the ones waiting, and the agent's row in the list says how many wait. See [Agent memory](#agent-memory).

The composer's Agent picker leaves out agents the Conductor may not delegate to, as `list_crew` does, except the Conductor itself, which the composer attaches in #conductor.

## Remote agents

A remote agent is an agent whose run is a server outside Omni: Hermes (`hermes`), or an AI service you connected, such as an [eve agent](harnesses.md#eve-agents) like Nomos. Its server is a detail of the agent ([ADR 0020](../adr/0020-remote-agents-are-agents.md)), so it never shows in the harness and model pickers, Auto never picks one, and a local agent never runs on a remote server. You mention it, seat it in a thread or start a thread as it, like any agent. How Omni reaches the server: [Remote agents' servers](harnesses.md#remote-agents-servers).

### Add remote agent

**Add remote agent** in Settings > Agents (and on the Harnesses step of setup) connects a server without pasting its key, on desktop web, the phone layout and the desktop app.

1. **On a Hermes server**, run the pairing helper the sheet shows, pinned to this build: `curl -fsSL https://raw.githubusercontent.com/ben-askphill/omni-os/<release tag>/scripts/omni-pair.sh | sh`. It prints an `omni://connect-agent` link, a QR code when `qrencode` is installed, and an address and code to type. It makes `API_SERVER_KEY` in Hermes's `.env` when there is none (restart Hermes after), and answers one pairing for at most 10 minutes. **For an eve agent** there is nothing to run: go straight to Find with its address.
2. **Find.** Click the link (the desktop app opens it), or paste it, a bare address, or the helper's address and code into the sheet. Omni looks at the address without a key and shows what it found: its name, avatar and host, what kind of agent it is, whether it is on this machine, the tailnet or https, and chips for what it can and cannot do. Plain `http://` off the tailnet, an address this machine cannot reach, a Vercel deployment behind Vercel's login wall, and A2A agents (a later version) say why they cannot connect.
3. **Sign in.** With a code, **Pair** redeems it server to server: the key goes into this machine's server and never reaches the page. An eve agent that pairs shows **Get a code**, which opens its own Connect Omni page in a new tab or your browser: sign in there if it asks, copy the code, paste it in the sheet and press Pair. Without pairing, pick the secret in Secrets that holds the key, or add it there from the sheet.
4. **Test.** One short turn on its own session ("Reply with one line: your name and the model you run on"), with the reply, the model, the time it took and its tokens, or which step failed and what came back.
5. **Connect** saves only after the test passed: a paired key as the global secret `AGENT_<SLUG>_KEY`, the server's file, and the agent, with the same id, delegatable, with no powers and no charter. **Open <name>** then opens its page. A failure at any step undoes the steps before it.

A link never reaches out to anything by itself: it fills the sheet in, you press Find, and Connect once its test turn passed. `#/settings/crew?connect=<link>` opens the same sheet on a phone or in a browser (an older `#/settings/models?connect=` link still works). Agent threads cannot add, change, test or remove one (403); the Conductor hands you the page instead.

**The avatar** is the one the server offers when it connects: a square PNG, JPEG or WebP data URL of at most 256px a side and 256 KB ([protocol](../internals/remote-harness-protocol.md#the-offered-avatar)). A server that offers none, or one Omni does not take, gets its crew character (Hermes the pebble in Lilac, any other one of the spare shapes), and Find says why. **Test connection** reads the offer again and takes a new avatar, unless you set one of your own in the agent's Identity block.

### A remote agent's page

Its page in Settings > Agents has the Identity block and editor any agent has, without the run and the powers it cannot use (its run is its server's, and it changes no files), and two cards of its own:

- **Server**: whether it is connected, **Test connection** and **Remove**, which is how a remote agent goes: the editor has no Delete for one, since its file alone would come back at the next start. With **Show technical details** on, also its address, kind, the secret its key is in and how many of its turns run at once, plus **Edit** for a server you connected and a link to Extras for Hermes's address. **Remove** revokes the key at the server when it offers that, deletes the secret Connect made for it (a secret you picked yourself stays), and removes the server's file and the agent, here and on your other machines. Editing its address or secret first makes Remove skip the revoke and leave every secret alone. Hermes gives every machine the same key, so to cut one machine off, change `API_SERVER_KEY` on the server. Removing Hermes clears its address on this machine and removes the agent; its key stays in Secrets.
- **In threads**: what it may do there. Files: it reads a thread's git-tracked files and diff in channels with **Remote agents can see this channel's work** on, and never changes them. Messages: the other agents' replies and a catch-up, in those channels, and elsewhere only the message to it.

The charter you write on its page goes to its server as instructions. Without one, Omni sends only who it is and how the thread works, and the server's own instructions lead.

### In a thread

- **Leading.** A thread started as a remote agent has it as its lead, and talks only. The crumbs read "<name> · talks only", the composer's placeholder says a local agent changes files, and the quick-actions card's model row is empty and its Files row says **Can't read or change**, or **Can read, can't change** in a channel with **Remote agents can see this channel's work** on. The thread gets its worktree at the start, like a local thread, so the machine, folder and branch rows fill.
- **Changing files.** Seat a local agent with an @ mention ([Agents in a thread](threads.md#agents-in-a-thread)). It edits the worktree; the remote lead does not. When something is left to commit, the composer shows **Commit**, which commits everything with the message you give (the thread's title by default) and says so in the transcript. **Open PR** then pushes the branch and opens the pull request. Only you commit or open the PR: an agent thread gets a 403.
- **Seated as a member.** A remote agent can sit in any thread, local-led or not, and answers the messages that name it. It gets the thread as text: a catch-up and the other agents' replies, in channels with **Remote agents can see this channel's work** on in Channel settings, where it can also read the thread's files ([Remote agents' servers](harnesses.md#remote-agents-servers)). Elsewhere it gets only the message addressed to it.
- **The lock line.** In a channel with **Remote agents can see this channel's work** off, each run of a remote agent's replies ends with "Remote agents can't read files in #<channel>", linking Channel settings. With it on there is none: the agent's reads show as tool rows instead.

### Threads and agents from before

At start, Omni turns what came before into remote agents, once and on each machine: Hermes in use (an address set, an agent or a thread on it) gets the agent `hermes`, and a server file no agent is bound to gets an agent with its name. A thread on `hermes` or `custom:<slug>` that its own agent does not lead is led by the server's agent from then on, and keeps working. Those older threads keep only their own data folder, so they show no Changes, branch or Commit. A thread whose server has no file on this machine yet keeps its harness and refuses to run, as before.

## No file edits

`tools: no-edits` (No file edits under Powers in Settings > Agents) takes an agent's file-edit tools away. The shipped reviewer has it. It is not read only: the shell stays, so the reviewer can run `gh pr diff`, git and the checks, and a shell command can still change a file. The agent's prompt tells it not to, and that is all that stops a command on any harness. Use a channel's Read only level ([Access levels](threads.md#access-levels)) or `access: read` when nothing may change.

| Harness | Blocked | Still runs |
| --- | --- | --- |
| Claude Code | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` (`--disallowedTools`) | Bash, reading, MCP tools, subagents |
| Codex | File patches: it asks before each one (`approvalPolicy: untrusted`) and Omni declines | Shell commands, with network, without asking you |
| Cursor Agent | File writes (`Write(**)` in its deny rules) | Shell, reading, MCP tools |
| Cursor Cloud | Nothing: Omni cannot take a tool away there, so the prompt is the only rule | Everything |

On Codex, a read-only sandbox would also stop the network, and with it `gh`, so Omni declines the patches instead. A channel at Read only or Ask first still holds the commands as its level says. `tools` is one of an agent's powers: an agent's save never sets it (see the crew guard below).

## The API

The clients edit agents through the API, the same files underneath:

| Call | Does |
| --- | --- |
| `GET /api/crew` | Every agent this machine offers, each with `kind` (`shipped`, `edited` or `own`), `hidden`, `tools`, `delegatable`, `review`, `memory`, `memoryWrites`, `memoryWaiting` when lessons wait, `locks` on the agents Omni relies on, `server` on a remote agent (`harness`, `builtIn`, `kind`, `url`, `host`, `secret`, `cap`, `available`, `fix`, and `avatarOffered` while its image is the one the server offered; never the key) and, for an edit, `charterMode` and `builtInChanged`. `?all=1` adds the hidden ones |
| `GET /api/crew/:id` | The agent, the built-in alone (`builtIn`), the shipped file's text, your file's text, the shipped charter's hash, and the charters as written (`charters.builtIn`, `charters.own`, `charters.effective`) |
| `POST /api/crew` | A new agent of your own: `{ id, fields, charter }` or `{ id, markdown }` |
| `PUT /api/crew/:id` | Edit an agent: `{ fields, charter?, charter_mode? }` or `{ markdown }`. On a built-in it writes the overlay. An empty field (or null, for `avatar`, `mcp`, `delegate_only`, `tools`, `delegatable`, `review`, `memory` and `memory_writes`) removes it. Send `charter` and `charter_mode` only to change them: either one records the built-in charter as seen |
| `POST /api/crew/draft` | `{ id?, own?, save }`: the file a save would write and the agent it makes, nothing written. `own` stands in for your file. Settings' form and Edit as Markdown turn into each other through it |
| `POST /api/crew/:id/duplicate` | `{ id, name? }`: a new agent of your own with everything this one has |
| `DELETE /api/crew/:id` | Delete an agent of your own |
| `POST /api/crew/:id/reset` | Drop your edit of a built-in |
| `POST /api/crew/:id/hidden` | `{ hidden }` for a built-in |
| `PUT /api/crew/:id/avatar` | `{ image }`: a square PNG, JPEG or WebP data URL of at most 256px a side, saved in the agent's file (an overlay on a built-in), or `{ image: null }` to remove it. Its icon and color stay. Only you set it: an agent thread is refused |
| `GET /api/crew/:id/avatar` | The uploaded image. Agents list it as `avatar.image`, a URL that changes with the image |
| `GET /api/crew/:id/memory` | The agent's lessons, waiting ones first, and how many wait |
| `POST /api/crew/:id/memory` | `{ text, channel? }`: a lesson for the agent, in the channel named or (null) every channel. Yours applies at once; see [Agent memory](#agent-memory) for an agent's |
| `POST /api/crew/:id/server/test` | A remote agent's Test connection: the test turn's outcome, and its offered avatar read again |
| `DELETE /api/crew/:id/server` | A remote agent's Remove: its server, the secret Connect made, and the agent |
| `POST /api/threads/:id/commit` | `{ message }`: commit everything left in a remote-led thread's worktree. 409 while an agent is running or with nothing to commit |
| `POST /api/threads/:id/open-pr` | Push a remote-led thread's branch and open its PR, `{ url }`. 409 while something is left to commit |

A save is refused when its run defaults, default channel or MCP servers are unknown here, when it breaks a lock below, when it puts an agent that only routes work on Cursor Cloud, where it would never start, or when an edit binds an agent to a remote server or takes one off it. Only you change an agent, test or remove its server, commit or open a PR in a remote-led thread: an agent thread gets a 403.

## Agents Omni relies on

Three built-ins keep fields and refuse actions, each with a reason the API sends as `locks` and Settings shows by the field. Everything else about them is yours to edit, and Reset always works.

| Agent | Locked | Refused |
| --- | --- | --- |
| conductor | `delegate_only`, the `omni` MCP server, `delegatable: false` | Duplicate, Hide |
| usage-scan | `delegate_only`, the `omni` MCP server, `delegatable: false`, and its charter can only be added to (`charter_mode: append`) | Duplicate (a copy would not be a usage scan: only Omni starts one), Hide |
| reviewer | `review: true` (`tools: no-edits` is not locked: turn it off, or duplicate the agent) | none: duplicate it for a reviewer without the review rules |

The locks hold however the file got there. A crew file another machine syncs that breaks one is refused and listed under Refused changes in Settings > Sync, and an overlay written by hand loads with the locked fields as the built-in has them (its other edits still apply).

No agent of your own takes one of these ids. Builder has no locks; Review PR runs as it, so while it is hidden Review PR refuses with a note to show it again.

An agent is a prompt every later thread of it runs with, so an agent thread's write (any call with a thread's own token, which every thread and its MCP servers hold, or one that names a thread in `x-omni-thread`) goes through the crew guard (`apps/server/crew-guard.ts`) and gets a 403 unless all of these hold:

- It is a save or a reset. Deleting, hiding and showing an agent stay yours, in Settings. A reset that would change the agent's powers (your edit gave the built-in the conductor tools, say) is refused: reset it yourself.
- The thread runs as the Conductor. No other agent writes agents, even one you gave the `omni` MCP server, and usage-scan never does.
- The save leaves powers alone: no `mcp`, `delegate_only`, `tools`, `delegatable`, `review`, `memory` or `memory_writes`, and no whole-file `markdown`. Those are yours to set.
- No automation started the thread or any thread above it.
- You answered in that thread after its first message, or answered a question it asked. The guard cannot read whether you agreed: it holds the Conductor to proposing an edit and waiting for you. An agent's own call never counts as your answer: a message an agent thread sends, including through `check_artifact_comments` or a compact, is recorded as the Conductor's, and an agent thread cannot answer a question card. The same holds for review notes an agent thread sends, and for messages a thread carries when it moves to another machine, which keep their sender.

Like the automation guard, it holds every path Omni gives a thread: its MCP servers, the `omni` command and `curl` with `$OMNI_TOKEN` all carry the thread's own token, with or without the header ([ADR 0016](../adr/0016-thread-bound-credentials.md)). A thread that reads `data/api-token` from disk on purpose is not stopped yet; that needs the OS sandbox the ADR leaves for later.

The Conductor writes agents with its own tools, which go through that guard:

- `get_crew_role` reads an agent by id, the Conductor and usage-scan included: its fields, powers, locks and charters as written (`charters.built_in`, `own`, `effective`), and its `avatar`: what it shows (`photo`, `icon` or `character`) and its character's `shape` and `color`, the ones its id picks when its file names none (`{ shows: character, shape: squircle, color: Amber }` for Builder). A color from the agent palette comes by name, any other as its hex.
- `save_crew_role` creates an agent of your own (`create: true`) or edits one. On a built-in it writes your overlay, adding to the charter unless it says `replace`. Its `charter` is the whole text of your file for the agent, so the Conductor starts from `get_crew_role`. `fields.avatar` restyles the agent's character: `shape`, one of the 16 crew shapes, and `bg`, a hex or an agent palette color by name (Sky is saved as `#52cdfe`); an empty string removes either, so the default comes back. An unknown shape or color is refused with the ones Omni knows. Icons, emoji and photos stay yours to set, in Settings > Agents, and show instead of the character.
- `reset_crew_role` drops your edit of a built-in.

The Conductor proposes the agent or the edit in its thread and saves it once you answer. An agent it creates names no power, so it gets what any agent without them gets: no conductor tools, not delegate-only, not a review agent, and delegatable, so `list_crew` and `delegate` offer it at once. It shows in Settings > Agents as Yours and syncs as `crew_file`, like an agent you made. A power the save names comes back as the guard's refusal, and nothing is written. No Conductor tool deletes, hides or duplicates an agent. The external MCP has none of these tools: its calls name no thread, so the guard would take them for yours.

Your edits sync to your other Macs as `crew_file`, a signed action that applies only from a trusted machine ([Sync](sync.md)). Hiding stays per Mac.

The frontmatter sets each agent's model and, for conductor and inbox, its default channel. The conductor defaults to `model: auto`, so the Overview and Conductor composers start on Auto; a saved #conductor channel default still wins (see [Auto](harnesses.md#auto)). The other agents also default to `model: auto`, so each delegated brief gets the model it needs. Pin a model in an agent's frontmatter to opt it out.

The conductor does not review a PR by itself. When a builder reports one, it relays the PR and you say whether you want it reviewed. When you ask, it delegates to `reviewer` with `review_of: <builder thread id>` and no run, and Omni picks the other model family from that thread's run (`apps/server/harness/review.ts`):

- Work Claude wrote (Claude Code, Hermes, or a `claude-*` model on Cursor) is reviewed on Codex, on `gpt-6.1-sol` at `high`. The Conductor's brief then follows `/code-review:code-review` from the `gpt-review` skill where the machine has it in `~/.agents/skills`, else the reviewer charter's own steps.
- Work any other model wrote (GPT, Composer, Grok, Gemini) is reviewed on Claude Code, on `claude-opus-5-5` at `xhigh`.
- Those runs are pinned. When this machine's catalog lacks the model, or the model lacks the effort, the review is refused (409): Omni never runs it on Codex's default or the nearest model or effort instead.
- A run the delegation names is kept when it is on the other family. The same family is refused, and so is a thread whose run does not say its family (Cursor's own `auto`, a runtime Omni does not know), or a review whose harness is not available here. The Conductor then asks you.
- `review_of` needs a review agent. It is on `POST /api/threads` and on the Conductor's `delegate` tool.

A thread as a review agent (`review: true`: the shipped reviewer, or an agent of your own with Reviews work on) on a GPT model (Codex, or a `gpt-*` model on Cursor) always runs at `high` effort. Omni sets it when the thread is made, switched to another run or continued, even when `xhigh` or no effort was asked for. Claude reviewers keep the effort they were given.

`delegate_only: true` in an agent's frontmatter makes it a router that runs without the tools that do work. The conductor sets it, and so does usage-scan, which only reads its first message and saves what you pick.

- Claude Code: `--disallowedTools` for Bash, Edit, Write, NotebookEdit, Agent, Task, Workflow, Artifact, ArtifactData and the browser MCPs.
- Codex: a `read-only` sandbox.
- Cursor Agent: its own config folder in the thread's data dir, passed as `CURSOR_CONFIG_DIR`. Its `cli-config.json` is a copy of yours with `Shell(*)` and `Write(**)` added to `permissions.deny`; everything else in the folder links to yours, so the login and chats stay put. Deny rules hold under `--force`, and MCP tools stay allowed. Cursor's read-only `--mode ask` is no use here: with `--force` it blocks nothing, and without it it blocks the `omni` tools too.
- Hermes and Cursor Cloud: refused. A thread there gets no `omni` tools, and Hermes takes no per-run tool limits, so a router could only do the work itself. Creating such a thread fails with the reason, and a Hermes thread that already has the agent fails its turn the same way.

None of them gets the `omni-browser` MCP, and the system prompt drops the Artifacts and Browser sections for a router's rule: answer a quick ask (the conversation, Omni's own state, a light lookup) in the thread with no new thread, no brief and no folder question, and delegate work that writes, runs, browses at length, changes code or a store, or will clearly grow. The Conductor's rule follows its charter instead: its first action for that work is `seat_agents` in its own thread, and it uses `delegate` or `delegate_team` directly only for a review, a team you asked for, tasks on machines you @mentioned, or when you ask it to delegate. A router can still read files, search, use its connectors and use the `omni` tools to answer or to write a brief.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `list_channels`, `list_crew`, `get_crew_role`, `save_crew_role`, `reset_crew_role`, `crew_memory`, `remember`, `list_harnesses`, `harness_accounts`, `delegate`, `delegate_team`, `file_thread`, `message_thread`, `mark_thread_done`, `recover_thread_session`, `switch_thread_run`, `continue_thread`, `get_thread`, `list_threads`, `list_pull_requests`, `search_history`, `list_published_artifacts`, `check_artifact_comments`, `list_claude_artifacts`, `refresh_claude_artifacts`, `list_devices`, `machines`, `hand_off_thread`, `signed_in_devices`, `revoke_signed_in_device`, `rotate_install_token`, `mcp_clients`, `remove_mcp_client`, `send_to_grok_bot`, `read_referenced_thread`, `watch_pr`, `set_auto_merge`, `crew_prs`, `rerun_failed_checks`, `crew_questions`, `list_review_notes`, `list_automations`, `run_automation`, `set_automation_enabled`, `delete_automation`, `get_automation`, `save_automation`, `list_automation_deliveries`, `retry_delivery`, `skip_delivery`, `set_automations_machine`, `scan_usage`, `list_channel_actions`, `run_channel_action`, `worktree_storage`, `disk_space`, `settings`, `set_secret`, `sent_secrets`, `insights`, `tool_failures`, `triage_tool_failure`, `note_tool_failure_recovery`, `omni_connect_status`, `omni_connect_set`, `omni_update`. A tool that takes a `thread_id` also takes its first 8 characters or its `omni/<id>` branch, as the `omni` command does, looked up among the latest 500 threads. A delegated thread runs in the target channel; when it finishes, Omni posts its reply to the conductor as a crew report (tagged with the task id). The report shows on that thread's row of the delegation card (desktop web, phone web and iOS) and starts no Conductor turn: the conductor's harness reads it with your next message. A delegation made with `follow_up: true` (the conductor will act on the report: the next step of a chain, combining reports, a review's findings) wakes the conductor instead, as a busy conductor is steered the report while it runs. Reports to any other parent wake it with a line of its own: use the report in its work, as data (from a server outside Omni when the child ran on one), rather than relay it. A report from a remote child names its server in the header. An agent you seat in a thread answers there instead, in a session of its own ([Threads](threads.md#agents-in-a-thread)). In the sidebar, the Inbox and phone Activity, each Conductor thread shows its delegated threads (and, for a team made before teams became one thread, its members under their lead) as a tree under its row; how it opens, closes and what it lists are in [Threads](threads.md). The parent's header shows an overlapping avatar for each channel its delegated threads work in, once per channel and finished threads included, with every channel named in its tooltip. It shows only when one of them works outside the parent's own channel, draws four discs at most (three avatars and a +N chip past four channels), sits in the sub line on a phone and opens the parent's Details. The parent's Inbox card, sidebar row and phone Activity row show the same avatars ([Threads](threads.md)). A thread started as an agent names it by the charter's `name` (Builder, Store ops) beside the channel crumb in its header, in a Agent row in Details, and in the sub line under the title on a phone and in the iOS app. A thread without an agent shows neither. The parent's Details tab lists its delegated threads, and the Conductor's channel page on the desktop still nests them under their parent. The phone Conductor list keeps a delegate count that opens the parent's Details. Any agent whose frontmatter includes the `omni` MCP (Claude Code, Codex or Cursor Agent), except usage-scan, also gets a short Thread delegation section in its system prompt: use `delegate` or `delegate_team`, call `list_crew` and `list_channels` for valid ids, and write each brief as Goal, Done when and Proof back, since the child thread cannot see the parent's chat.

A parent follows up on a thread it already has with the prompt cache in mind (`apps/server/session-warmth.ts`). A thread's session counts as warm while it runs, before its first turn, and for an hour after its model's last reply, tool call or turn end; `get_thread` shows this as `session` (`warm`, `last_activity_at`, `idle_minutes`). A warm thread gets `message_thread`. The parent does not wake a cold one. It opens a new session with `continue_thread` or delegates a fresh thread that links it, and says which thread replaced which. `message_thread` (a send `from: "conductor"` to `POST /api/threads/:id/messages`) returns 409 for a cold thread unless it passes `wake_cold: true`, for when you asked to resume that thread itself. Your own messages from the composer are never refused. The hour is the best case. The provider can drop a cache sooner, for example to 5 minutes in overage, and Omni cannot see that.

## Thread delegation

The Conductor hands work on with three tools. Each makes or reaches a thread in the client channel, never in #conductor.

- **`delegate`** makes a thread of its own on one agent, with a task id, and its crew report comes back when that agent's turn ends. `members` seats more agents in it with no turn: they work when a later message names them. The report still goes when the lead's turn ends, even if members are at work.
- **`delegate_team`** makes a team: one thread with its lead (`role`) and a member per agent with a part (`tasks[].role`), all seated before the brief. A part with no agent is the lead's own, and an agent with two parts gets one seat with both. The lead must run on a local harness. It plans on the brief first, then gives each member its part with `message_members`, a tool on the `omni-team` MCP server that only a team's lead gets. The members work at once in the thread's one worktree. Once every one it messaged has finished, a failed or stopped one included, Omni wakes the lead once with their replies, and the lead's answer is the team's one crew report. A member waiting on you keeps the lead waiting, and there is no time limit. See [Teams](threads.md#teams).
- **`message_thread`** with `agents` sends a follow-up as agent mentions: the named agents not seated yet are seated, and the message goes to them.

The server holds the Conductor (any agent thread, known by its own token) to where it may seat agents: in its own #conductor thread, and in a thread whose parent is itself, never in any other #conductor thread. `POST /api/threads` with `members`, `POST /api/threads/team` and a message with agent mentions anywhere else get a 403 and nothing is made. Only you seat agents in a thread another machine holds, there. You seat agents anywhere, #conductor included. Teams made before teams became one thread keep their tree: a lead thread with a member thread per part under it.

| Route | What it does |
| --- | --- |
| `POST /api/threads/team` | `{ channel, title, prompt, role, task_id?, folder?, tasks: [{ title, prompt, role?, harness?, model?, effort? }] }`: the team thread and `members` (`agent`, `name`, the titles of its `parts`) |
| `POST /api/threads/:id/team/messages` | `{ to: [agent id or name], message }`: a team's lead gives members their parts. Only that lead, by its own thread token; any name that is not a member seated now is refused |

## Recent learnings

Each channel's settings has a **Recent learnings** card (Channel Settings > Recent learnings on iOS): short lessons every later thread in that channel gets in its prompt, whatever its agent or harness, such as "Quote prices without VAT for this client". A thread in another channel never sees them, so what Omni learns in one client's channel stays there.

- Add one yourself and it applies at once. The Conductor proposes them with `propose_learning` (and reads them with `list_learnings`), from corrections you make or steps a crew thread missed. A proposal shows **Waiting for you** and applies only once you approve it. Editing a proposal approves it too.
- Agents only propose. Approving, editing and deleting stay yours, and a thread other than the Conductor can propose only for its own channel. Text that looks like a secret is masked before it is saved. As with agents and automations, this holds the tools agents are given, not a thread that calls the API from its shell with the install token: Omni cannot tell that call from yours until threads get tokens of their own.
- Learnings sync to your other machines as a signed change, like crew files: a machine you have not trusted cannot add one.
- A thread gets the newest 20 approved learnings, up to about 4,000 characters, starting with its next run.

## Agent memory

Each agent has its own memory: short lessons about how the agent should work that every later thread of it gets in its prompt, on every harness, such as "Run the repo's own check script before you report". A lesson holds in every channel, or only in the channel it is tagged with, so what an agent learns about one client stays in that client's threads. Channel learnings (above) are lessons for every agent in one channel; agent memory is lessons for one agent. The lessons sync to your other machines as a signed change, as learnings do.

- **Add** one in Settings > Agents > the agent > Memory, for every channel or one, and it applies at once.
- **Its threads propose** with `remember` (the `omni-memory` MCP server an agent's thread gets on Claude Code, Codex and Cursor Agent): one short sentence, for their own channel unless they pass `everywhere: true`. The Conductor proposes for any agent with `remember` and lists an agent's memory with `crew_memory`.
- **A proposal waits for you** in the agent's Memory group, which counts them in its title, marked Waiting for you, and the agent's row counts it. Approve, edit (which approves it) or dismiss it. Nothing an agent sends makes a lesson yours: it stays marked as proposed by an agent, with a link to its thread.
- **Applies at once** (`memory_writes: auto`) skips the wait for that agent. Each lesson it keeps that way names its thread, shows Kept at once, and the server logs it. A thread under an automation or a usage scan still only proposes, and so does a lesson for every channel from a thread other than the Conductor: it would carry one channel's lesson into every other.
- **Memory** (`memory:`) is Reads and proposes (`read-write`, the default), Reads only (`read`: its threads get the lessons but cannot propose, and only you add them) or Off (`off`: no lessons in its prompt, none proposed; the lessons it has stay).
- Agents only propose. Approving, editing and deleting stay yours, `memory` and `memory_writes` are powers an agent's save cannot set, and a thread other than the Conductor proposes only for its own agent. Text that looks like a secret is masked before it is saved.
- A thread gets the newest 20 approved lessons, up to about 4,000 characters, starting with its next run. Hermes and Cursor Cloud get the lessons but no `remember`: they run no Omni MCP server. A quick ask gets neither.
