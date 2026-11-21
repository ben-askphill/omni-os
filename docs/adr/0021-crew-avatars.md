# Every agent is a crew character, and its eyes show what its thread is doing

> Decided with Ben on 2026-11-21. D1 to D24 answer the crew avatars plan's open questions, D25 to D27 came with spec #918 (from PRD #917) the same day, D28 and D29 after it. Not built yet: #918 splits the build into pull requests P1 to P16, and P13 is dropped (D7). Until each one ships, the docs it changes (see Supersedes) describe what runs.

An agent without a photo or an icon of its own looks like a placeholder. Five of the nine built-in agents (Conductor, Researcher, Builder, Store ops and Admin) show a small grey crew mark. Every other agent shows two letters on a pale initials disc, which drops its letters below 18px. The face says nothing about state: Ben reads the status mark beside it, or a ring drawn around it, and on a group thread's avatar mark the Needs you diamond sits on the face ([ADR 0019](0019-group-threads.md#how-it-looks)). The Web UI and the iOS app each keep their own copy of the fallback chain.

The crew avatars design (the `omni-crew-avatars-spec` export, checked against the design boards) draws 16 shapes, each the Omni ring bent into a silhouette with the logo's stroke and its 10° lean. It adds a 14-color agent palette, eyes for each state, a drawing for each size and motion for each state. Ben decided the plan's 24 open questions on 2026-11-21 and took its recommendation on all of them but D3.

## Decision

### The face

- **The chain (D1).** An agent shows its uploaded photo, else its icon, emoji or SVG on its color, else its crew character. The initials disc and its two-letter rule are retired, and so is "color only below 18px": the drawings on the 18 grid cover small sizes. Two letters on a pale disc made the agents Ben creates look alike, and one default face leaves no leftover choice in Settings.
- **The shape when none is set (D2).** A shared table keyed by agent id gives the nine built-in agents their shapes, Store ops and Hermes included, although neither ships as a crew file (Store ops is Ben's own agent, and Omni makes Hermes when Hermes is in use). Any other agent gets one of the seven spare shapes from the FNV-1a hash of its id that the avatar code already uses. So an agent looks the same on every machine and client, and keeps its face when it is renamed. The table lives in code, not in the shipped `crew/*.md` files: an overlay replaces the whole avatar map, so a shipped shape would vanish under any overlay that sets an icon.
- **The color when none is set (D13).** Each shape keeps the color the design pairs it with, and one hash picks a spare shape and its color together. With the spares in the spec's order, Designer lands on bucket in Amber, Builder's color. Ben can pick another shape once Settings has the picker.
- **One face for both clients.** The chain, the character and its motion come from one pure function in the shared package, `agentFace()` in `packages/shared/agent-avatar.ts`. The Web UI and the iOS app draw what it returns and decide nothing about an avatar themselves. It takes the agent, the pixel size, what the avatar shows (a status mark, a member state or nothing), where it sits (in focus, in a list row, or still) and whether reduced motion is on. The server resolves no default and sends what the file says, so a newer iOS app paired with an older server still draws characters. This function is seam A (D27).

### Color and the crew file

- **One color key (D4).** `avatar.bg` stays the agent's one color: the character's body, an icon's disc and the agent's mention pill, which already reads it. Color says who the agent is and never changes with state. The crew file gains one key, `avatar.shape`, one of the 16 shape ids. Reading drops an unknown shape, so a shape a later build adds falls back to the default on an older one. Crew files already sync whole, so sync needs no new handler: an older build ignores the key, keeps it on its next save and shows its old look until it updates.
- **The agent palette (D20).** Fourteen named colors replace the old swatches for agents: Ink, Sky, Amber, Violet, Rose, Mint, Green, Sun, Lilac, Magenta, Azure, Aqua, Teal and Peach. The design draws every shape in one of them. The three status colors are reserved and never an agent's: Ultramarine `#2b3bff`, Vermilion `#ff4420` and Volt `#c6f52b` (`--live`, `--needs` and `--done`), so blue, red and green keep meaning running, needs you and done. A custom hex stays possible and shows as Custom.
- **Channels keep their colors (D5).** The new palette is for agents only. Channel avatars keep today's swatches, so channels look as they did.
- **One eye ink (D19).** Eyes, and the ink on channel avatars, take whichever of `#17181a` and white has more contrast. `#17181a`, the light theme's foreground (`--fg`), replaces `#202020` everywhere, channels included, so every face uses the same dark ink. The pick matches the spec's ink for all 14 colors and flips no current channel swatch. The lowest eye contrast is Magenta with white, 4.25:1, above the 3:1 minimum for graphics.

### Geometry

- **Generated from the spec, not computed (D12).** The spec JSON is committed as is under `packages/shared/scripts/crew-avatars-spec/`, taken from the export linked in the first comment on #918 (sha256 `72d04eea75c9fb10d211b6de18500d90ec6d229514ee730d6ae638cff013fdcd`). A script turns it into the checked-in `packages/shared/crew-shapes.ts`. For each shape, that holds an upright closed outline for each size stop (16, 18, 24, 32, 48 and 64px) with the grid it draws on. For each eye layout, it holds the eye centres for each size and state. It also holds both eye glyph sets and the Conductor's satellite droplet. The outlines, eye centres and each pose's glyph exist only in that JSON, a geometry fix becomes a data change and a regenerate, and nothing from the export runs. The shared modules hold static data and arithmetic only, at the package's top level, so they run on the iOS app's Hermes engine and its built-ins check scans them.
- **The JSON wins (D14).** Where the export's Python comments disagree with its JSON, the JSON wins. On the small grids that gives a 2.0px stroke and 2.8px eyes on the 24 grid, and 1.5px and 2.25px on the 18 grid.
- **"Stroke 15, eyes 13" from 64px only (D15).** The spec's stroke 15 and eyes 13 on the 128 grid (15/128 and 13.05/128 of the size) apply from 64px up. Below that, the size table's per-stop values hold, because stroke and eyes are set for each size, not scaled.
- **The small eye set from 31px down (D16).** Circles, rounded squares, diamonds and arcs at 32px and up; dots, plain squares, tall bars and chevrons at 31px and down, 24px included. The JSON draws it that way, and the switch falls on the same line as the switch from the 128 grid to the 24 grid.
- **Pill-diagonal eyes (D21).** The pill-diagonal's eye pair tilts −38° along the pill at every size stop where the tilted pair clears the outline, and stays level where it does not. The generated data records which stops stay level. Clearance comes first, so the eyes never touch the outline.
- **Eyes fitted where the spec's would not clear.** At the sizes avatars draw at (16, 18, 20, 22, 24, 28, 30, 32, 48, 64 and 88px), the spec's eye centres with the size table's eyes come closer to the outline than the clearance in some places: most shapes at 16px (the export has no 16px centres, and its 18px ones were placed for a 2.25px eye, not 2.44px), some glances at 20 and 22px on the 24 grid, a few poses of the pill-tall and the fan at 64px, and three glances at 18 and two at 48px by a few hundredths of a pixel. The generator moves only those pairs, the least that clears (at most 0.37px): pulled together about their midpoint, then shifted inward. `CREW_FITTED` in `crew-shapes.ts` lists them, and a new avatar size is one more entry in the generator's list and a regenerate. The export names each pose's glyph, centre, diameter and line weight; the face draws every glyph inside the circle of that diameter, so one clearance covers them all. The export's 36 and 128px entries are not stops: 33 to 40px draw the 32px stop, and 128px is the 64px drawing again.
- **16px is the smallest size (D22).** The avatars drawn at 14px today move to 16px: the thread header, composer chips, inline mentions, the phone thread's sub line and the iOS thread title. 16px is the design's smallest stop, so nothing draws below a size it covers.
- **Eye size from the size table (D24).** The eye diameter is linear between the size table's values (2.44px at 16, 2.25 at 18, 2.8 at 24, 3.16 at 32 and 4.41 at 48) and never under 2px. The spec's stated eye ratio, "from 1.55 at 16px", disagrees with the table's 2.44px there, and the table wins: it holds the values drawn for each size.

### Eyes from thread state

- **The status mark's rule.** The eyes take the status mark's rule of who has the ball (`MarkFamily` in `packages/shared/status.ts`): circles while the agent has it (idle, thinking or working), squares while a system outside Omni does (waiting), diamonds when Ben does (needs you), arcs when it is done. The eyes and the status mark then speak the same shapes, and every state the eyes need is sent today.
- **States the rule does not place (D6).** Failed, crew failed, setup failed and ready for review take the needs you diamonds: each waits on Ben to look into it or act. Usage limit and Resumes at reset take the waiting squares: the usage limit, outside Omni, holds the ball.
- **Thinking and waiting (D7).** The open thread tells thinking (starting, or working while no tool call is open) from working (a tool call running), because its rows are at hand. A running thread in a list and a working member show working: the server sends no turn phase there, and the eyes do not need one. So the optional server PR that would have sent it (P13) is dropped. Delegating and queued take the waiting squares: the agent waits on other threads or on a free slot. "Thinking" is an eye pose, not effort.
- **Past replies stay idle (D11).** Author avatars on past replies show idle eyes, and only the head of the reply being written shows live state, so history does not look busy. Avatars with no thread behind them (Settings, pickers, mentions) are idle too.

### Rings and corner pops (D8)

- Characters draw no ring. The Needs you diamond leaves the face on the avatar mark, and the phone row's status dot leaves the avatar's corner. Both sit beside the avatar, in the status mark's place at the row's far end. The eyes carry the state, so a ring would repeat it, and nothing covers the face. Photo and icon avatars have no eyes, so they keep the working and Needs you rings.
- Faces in a pile (the member avatars, the avatar mark, the iOS member sheet and mark line) sit side by side with a small gap instead of overlapping. With no disc behind a character, an overlap hid part of the next face, often an eye. Added after the code review of the build.

### Motion

- **The Motion board (D17).** Each state moves as the design's Motion board draws it. Idle breathes and blinks, thinking sways and looks around, working bounces and scans, waiting breathes slowly, needs you holds still, and done hops once. A state change squeezes the eyes shut and springs them open into the next state, idle to thinking adds a beat of wide eyes, and a new agent in the same place pops the body. The keyframes and timings are the spec's (#918). The 4.8s breathe is the live Omni mark's breath (`--dur-breathe`), and the 2.4s sway is the design system's tick (`--dur-tick`). Needs you holds still so it stands out against everything that moves.
- **Where loops run (D10, with D29).** Body and eye loops run where one agent is in focus, and in a row or card only while its thread is working (D29). They run in focus: the thread header, lanes, the member list and the Settings preview. Otherwise list rows play only the one-shot changes (squeeze, wide-eye beat, hop), and only on a live change, never on first render: a list that loads fifty done threads draws fifty still faces. A long Inbox stays calm and fast instead of turning into a field of bouncing faces.
- **A running thread moves wherever its avatar shows (D29).** Ben asked for this after D10 shipped: with a delegated thread running, its builder stood still on the Delegation card and in the sidebar until he opened the thread. A row or card whose agent is working now plays the working loop, the same one as in focus, and stops when the thread finishes, fails or is stopped. It follows the live status, so no thread needs opening. Every other row state stays calm, so a list of finished threads still draws still faces, and only the threads that really run move. D10's rule for the rest is unchanged: the pop and the other loops stay in focus.
- **Reduced motion (D18).** With reduced motion on, nothing in an avatar moves: no body loop, eye loop or transition. Each state rests on its own eye glyph at its own centres, and a state change swaps at once, so state still reads.
- **One set of numbers, played from code (D25).** Every keyframe and timing lives once, in `packages/shared/crew-motion.ts`, and the agent face hands it to both clients. The Web UI plays it through the Web Animations API (`element.animate()`) and the iOS app through Reanimated. The web has no CSS keyframes for avatars, so the two clients cannot drift apart. Easing uses the existing fluid, spring, settle and stretch curves. Eye glyphs swap behind the squeeze instead of morphing, since Safari has no CSS `d`. Everything the web uses is Baseline widely available at the iOS Safari 18 floor, so it needs no fallback.
- **Reduced motion is the only off switch (D28).** There is no Animate avatars setting. The system setting reaches every surface and the iOS app already.

### Thread rows (D23)

- Every thread row leads with its agent's avatar, then the title, then the status mark at the far end. In the thread list that is a 32px avatar, a 12px gap and the 8px status dot; in the channel rail's 32px-tall rows, an 18px avatar with an 8px gap. A thread with no agent keeps its channel avatar in that slot, and a group thread keeps its avatar mark there. The iOS app's thread rows and Activity follow the same order. Ben can scan a list by agent, and both lists read alike. The web rows (P14) and the iOS rows (P15) both stay in the build.

### The built-in marks retire (D9)

- The crew marks (`CREW` in `packages/shared/brand.ts` and both `CrewMark` components) are retired everywhere, pickers included. Delegation cards, ask cards, the automations list, thread details and the iOS crew report cards show the agent's avatar instead, and built-in agent names move out of the marks' data. Only five of the nine built-in agents had a mark, and an agent should look the same wherever it shows.
- The Conductor keeps one exception, decided once beside the face in `conductorChannelLook()` (`packages/shared/agent-avatar.ts`) for every surface: its agent's own photo or icon, else the icon and background saved for the Conductor channel, else its crew character. Thread rows and reply author lines use it on desktop web, phone web and the iOS app.

### The switch of shared-glyph agents

- **Switch now (D3).** A one-time step on server start, guarded by a kv flag, rewrites each of the user's crew files whose `avatar.icon` is a shared glyph (`icon:<name>`). It removes the icon, keeps every other key and the charter, writes the file and records it for sync. On Ben's machines that covers Builder, Conductor, Designer, Reviewer and Usage scan, which then show their characters without Ben changing each one by hand. The plan had recommended keeping these icons until Ben switched each agent himself, and Ben decided against it.
- **The rule names glyphs, not agents.** It covers exactly those five, names no agent in shipped code, and treats the old glyph faces the same on any install. Emoji, SVG and photo avatars and a remote agent's offered photo were personal picks, so the step leaves them alone. An icon picked later still wins over the character: the chain does not special-case these agents.
- **Its color rule (D26).** The same step removes `avatar.bg` unless it is one of the 14 agent colors, so the paired color shows and the switched agents look as the design draws them. Builder's `#ffa424` gives way to Amber, Conductor's `#1e1e1e` to Ink, and Designer's `#d4e9fa` to Amber, bucket's pair. A palette color is kept.
- **When and where.** The step ships no earlier than the Web UI drawing (P5), so no install loses its icons before it can draw characters. Each machine runs it once on its first start with the new build. Both machines write the same content, so the last writer wins harmlessly.

### Tests at two seams (D27)

- **Seam A, the agent face.** Unit tests call `agentFace()` with real agents, sizes, marks and member states and check the drawing and motion it returns, against the committed spec JSON (`packages/shared/tests/agent-face.test.ts`). They cover spec fidelity for every shape, stop and state, the size math and clearance, state to eyes, the pick and the ink, and motion.
- **Seam B, a test server over its own data folder.** `startRunner` from `apps/server/tests/runner-boot.ts`, driven through the agents API and the Conductor's tools, covers the shape key, the migration, the recorded agents wire fixture and the Conductor's save and view.
- **Nothing else gets a new test.** The web and iOS avatars only draw the face, so screenshots of every surface and the `verify` skill check them. Existing tests that cover changed behavior are updated so the suite keeps passing. A test drives a seam from outside with real inputs and never reaches into the modules behind it.

### Settings and the Conductor

These come from #918 and carry out the decisions above.

- **Settings > Agents.** Avatar sources become Character, Emoji, Icon and Upload, with Character the default in place of Initials and Built-in. Under Character sit a Default tile (the id's pick) and the 16 shapes in their paired colors, as a radio group with roving focus. The built-in's own shape says Built-in, and a shape another agent shows names that agent. The color chips are the 14 agent colors by name, with a custom hex and Reset to auto, which returns to the shape's paired color. The preview shows the avatar at 88px, 20px and 18px, and the six eye states, still. The phone layout shows the same page. The iOS app has no agent editing and gets none here.
- **The Conductor.** `save_crew_role` takes `avatar.shape` and `avatar.bg` (a hex, or an agent color name such as Sky) only after Ben agreed in the thread, like every field. `get_crew_role` reports what the agent shows now through the agent face, defaults included ("droplet in Sky"). Icons, emoji and uploads stay in Settings, and the D3 switch is the migration's job, not the Conductor's.

## How it looks

The 16 shapes, their agents and their colors. The eye ink follows D19.

| Shape | Agent | Color | Eye ink |
|---|---|---|---|
| circle | Conductor | Ink `#17181a` | white |
| droplet | Researcher | Sky `#52cdfe` | ink |
| squircle | Builder | Amber `#ffa839` | ink |
| pill-wide | Reviewer | Violet `#9834fd` | white |
| arch | Writer | Rose `#ff4983` | ink |
| tray | Admin (`inbox`) | Mint `#4aefa7` | ink |
| triangle | Store ops | Green `#02c650` | ink |
| pill-tall | Usage scan | Sun `#ffdc4f` | ink |
| pebble | Hermes | Lilac `#bda7fe` | ink |
| diamond | spare | Magenta `#df00c5` | white |
| bubble | spare | Azure `#0093e4` | ink |
| cloud | spare | Aqua `#0ee6e9` | ink |
| pill-diagonal | spare | Teal `#00a8a2` | ink |
| fan | spare | Peach `#feb98b` | ink |
| shield | spare | Violet `#9834fd` | white |
| bucket | spare | Amber `#ffa839` | ink |

- **The drawing.** One closed path per shape and size stop, filled with the agent's color and outlined in the theme's foreground (`#17181a` light, `#eceae5` dark). There is no disc behind it. The whole avatar, eyes included, leans 10° like the Omni mark: a skew about the drawing's centre at draw time, with the data kept upright. Only the Conductor has a satellite droplet, in the outline's color.
- **Grids and stroke.** The 128 grid at 32px and up, the 24 grid from 19 to 31px, the 18 grid at 18px and down. A size draws the nearest stop on its grid. The stroke is linear between 1.4, 1.5, 2.0, 2.75, 4.5 and 7.5px at the stops, and 15/128 of the size from 64px. Eyes clear the outline by the larger of 0.75px and 35% of the stroke.
- **Eyes for each state.**

| Eyes (32px and up / 31px and down) | Status marks | Member states |
|---|---|---|
| Circles / dots, idle | idle, stopped | idle, stopped |
| Circles / dots, thinking | starting, and working with no tool call open (open thread only) | none |
| Circles / dots, working | tool (open thread), any running thread in a list | working |
| Rounded squares / plain squares, waiting | delegating, queued, limited, resuming | none |
| Diamonds / tall bars, needs you | question, crew_question, held, signin, review, failed, crew_failed, setup_failed | needs, failed |
| Arcs / chevrons, done | done | done |

Idle, thinking and working differ only in where the pair of eyes sits. In a group thread each agent's face uses its own member state, so agents in one thread can show different eyes.

## Supersedes

- [ADR 0019](0019-group-threads.md#how-it-looks), How it looks: **Default avatars** (the initials disc, its two letters and "Below 18px the disc shows its color only"); in **The member list**, "a running agent's avatar gets a ring"; in **The status mark in a list**, the Needs you ring and "the Needs you diamond on its corner", and the Working ring. Characters draw no ring and the diamond sits beside the avatar (D8). Photo and icon avatars keep the rings. The same change reaches two more lines there: in the Decision, "Without any, the agent shows a colored disc with its initials. Built-in agents keep their marks." (D1, D9), and in **Mention pills**, "else its initials disc's color", which becomes the agent's color (D4, D13).
- [ADR 0020](0020-remote-agents-are-agents.md), "else the initials disc" in **Connecting makes an agent**: a remote agent that offers no avatar shows its crew character, Hermes the pebble in Lilac. The rest of ADR 0020 stands. The offered photo still wins until Ben sets his own look, and a shape Ben picks counts as his own look, so a later offer does not replace it.
- `GLOSSARY.md`: adds Avatar, Shape and Eyes.
- Docs that change when their pull request ships: the Avatar line in [Settings > Agents](../user/crew.md#settings--agents) (the Initials and Built-in sources and "Below 18px the initials disc shows its color only"), in P5 and P6, with a line on what the update did to glyph icons in P16; a remote agent's fallback in [Add remote agent](../user/crew.md#add-remote-agent) and [The offered avatar](../internals/remote-harness-protocol.md#the-offered-avatar), in P5; the rings and diamond on the avatar mark in [Status marks](../user/threads.md#status-marks), in P7.
- The design system's `CrewMark` card, retired in P12.

## Considered

The reasons below are the plan's and the spec's. Ben took the plan's recommendation on every open question but D3.

- **Shapes computed at runtime**, as `packages/shared/mark.ts` computes the live Omni mark each frame. That suits one liquid ring with one parameter set, not 16 shapes at six hand-tuned size stops. It would cost path maths on every render of every avatar in a list, and make the clearance rule a property of code instead of checked data.
- **Keeping the five icon agents' icons until Ben switched each one**, the plan's recommendation for D3. Ben chose to switch them now.
- **A migration keyed on the five agent ids.** It would name agents in shipped code and miss the same glyph faces on another install.
- **Keeping off-palette colors through the migration.** Builder would stay `#ffa424` and Designer pale blue, and the switched agents would not look as drawn.
- **Built-in shapes written into the shipped crew files.** An overlay that sets an icon replaces the whole avatar map, and the shape would vanish with it.
- **A default resolved by the server.** An older server would send no character to a newer client. The shared face resolves defaults on each client instead.
- **The new palette for channels too.** Channels would change color for no reason of their own. Only the ink is shared (D19).
- **Rings on characters and the Needs you diamond on the face.** The eyes already show the state, and a ring and a corner badge crowd and cover the face.
- **Loops in every list row.** A long list would turn into a field of bouncing faces, at a cost on every row.
- **CSS keyframes on the web.** The first version of PRD #917 had the web CSS read the motion numbers. Hand-copied keyframes are a second copy to keep in step with the iOS app.
- **Morphing eye glyphs.** Safari has no CSS `d`, so the glyphs swap behind the squeeze.
- **An Animate avatars setting.** Ben turned it down after #918 (D28).
- **Sending the turn phase for list rows and members** (P13). D7 shows working there, so nothing needs it.
- **Tests for the web and iOS avatars.** They only draw what the face returns, and seam A tests the face.

## Consequences

- Both clients' fallback chains move into `packages/shared`. The iOS app keeps its own image-path token check on top.
- The initials disc goes with D1 (`INITIALS_MIN_PX`, `agentInitials`), and `CREW` and both `CrewMark` components with D9. `AVATAR_SWATCHES` stays for channels, and the color picker takes its swatches from its caller.
- The migration rewrites the user's crew files once on each machine and records them for sync. A machine still on an older build receives files without the icons and shows its old fallback until it updates.
- The recorded agents wire fixture is re-recorded with an agent that has a shape.
- The design system gains an agent avatar component, the 14 agent colors marked as identity with the three status colors marked reserved, and the crew motion durations beside `--dur-breathe` and `--dur-tick`. Its identity, color picker and row cards change, and the `CrewMark` card retires. Each change updates the repo mirror in `design-system/`, and the Claude Design project needs a design sync while its MCP is not connected.
- No harness is affected: the eyes read Omni's own status marks, which every adapter feeds. The sync relay does not change, and the omni command gains nothing. The desktop app gets all of it through the Web UI ([ADR 0010](0010-desktop-app-is-electron.md)).
