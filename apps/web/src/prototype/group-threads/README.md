# PROTOTYPE: group threads (throwaway)

What should the agent UI look like for [ADR 0019](../../../../../docs/adr/0019-group-threads.md) (threads are group chats) and [ADR 0020](../../../../../docs/adr/0020-remote-agents-are-agents.md) (remote agents are agents)? Seven screens, two or three variants each, inside Omni's real channel rail and list panel. Nothing here is wired to a server. It lives only on the `prototype/group-threads` branch and is never merged.

## Run it

```sh
npm install --include=dev
npm run prototype          # vite on :4790, opens /prototype-group-threads.html
```

- The page draws the real `ChannelRail`, `ListPanel`, status marks and Settings parts on a fake `/api` (`fake-api.ts`, built on the recorded wire fixtures). Below 768px it draws each screen's phone version.
- The yellow bar switches screens and variants. Keys: `←` `→` variant, `[` `]` or `1` to `7` screen.
- Address: `?s=<screen>&v=<A|B|C|D>`, plus `tech=1` (Show technical details), `theme=dark`, `bar=0` (hide the bar), and per screen `closed=1` (screen 2, menu closed with Designer picked; screen 3, member list closed), `read=1` (screen 6, channel lets remote agents read files), `local=1` (screen 7, edit a local agent). Without `v` a screen opens on Ben's pick; the bar marks it PICK.
- Screenshots: `node apps/web/src/prototype/group-threads/capture.mjs <out dir>` with the server running (desktop 1440x900, phone 390x844). It takes the picks and their states; `ALL=1` adds every other variant, `ONLY=<screen>` one screen.

## Ben's picks (2026-11-20)

| Screen | Variants | Pick |
| --- | --- | --- |
| 1 Group thread | A Gutter · B Byline · C Turn cards | A, avatars 24px |
| 2 `@` agent mention | A One @ menu · B To line | A, with B's hint line |
| 3 Member list | A Header facepile · B Members strip · C Quick card | A, quick card keeps Lead and Members faces |
| 4 Two running, collision | A Inline · B Lanes · C Dock | B, one lane per tab on the phone |
| 5 Mark in the thread list | A Mark + faces · B Faces are the mark · C Second line · D Faces on the phone too | B on desktop, C on the phone |
| 6 Remote lead, talk only | A Quiet labels · B Notice card | A |
| 7 Settings > Agents | A Editor modal · B Agent page | B |

- **1 A Gutter.** The avatar sits in a 24px gutter (first drawn at 30px), the bold name and time on the line beside it. Consecutive replies from one agent share one head.
- **2 A One @ menu, plus B's hint.** The `@` menu lists "In this thread" agents first, then "Add to this thread", then machines and files. A line under the composer says who gets the message: the lead when nothing is mentioned ("Goes to Builder, the lead. Name an agent to send it there instead."), the named agent once one is picked ("Goes to Designer only. Designer joins this thread and stays until you remove it.").
- **3 A Header facepile.** Faces at the header's right open the member list (popover on desktop, sheet on the phone) with Remove per member. The quick card keeps the Lead and Members rows with their faces, as in screen 1; `closed=1` shows both with the list shut.
- **4 B Lanes.** The parallel turn splits into a lane per agent, each with its steps and changed files; the collision flag sits above the lanes. The phone shows one lane per tab.
- **5 B on desktop, C on the phone.** See below.
- **6 A Quiet labels.** "talks only" in the crumbs and the composer placeholder, a lock line under a reply that could not read files (with Channel settings), a Files row in the quick card.
- **7 B Agent page.** An agent opens as a page with its avatar on top and Avatar and Server as cards of their own. A local agent's page has no Server card.

### Needs you and Working at once (screen 5, B)

- The faces are the mark whenever an agent works or waits on Ben. Every other state keeps today's mark in the same 34px slot, so titles stay aligned.
- The agent that waits on Ben leads the stack and sits on top: its face in the Needs you ring, with the Needs you diamond on its bottom-left corner. The diamond carries the meaning where the ring's color is close to the avatar's own (Builder's orange).
- Agents still working follow underneath in the Working ring.
- Two faces at most. With more, the first face and a plain "+N" count.
- The row's tooltip and accessible name say every agent and state: "Builder needs you, Designer working".
- The phone (C) writes the same on the row's second line: the asker's face with ring and diamond, "Builder asks you", then the working faces and "Designer working".

## UI questions the prototype raised

These are Q48 to Q58 in the [group threads plan](../../../../../docs/plans/2026-11-20-group-threads.md) on PR #895.

- Initials collide. Reviewer and Researcher are both "RE" with `monogram()`. Channels get unique letters from `monograms()`; agents need the same, or Q4 covers initials as well as names.
- Two letters do not read below about 18px (facepiles, mention pills, list rows, the face mark). The prototype draws one letter there.
- When does the hint line under the composer show: always, once Ben types, or only when the message names an agent?
- The composer's run pill shows one harness and model. With several agents, whose run is it, and can Ben switch one member's run from it (Q15)?
- Should seating write a line in the transcript ("You seated Reviewer and Hermes")? The ADR does not say. Without one, nothing marks when an agent joined.
- Agent mention pills use the machine pill's blue. Should agent and machine mentions look different?
- The header shows the member facepile and the Working pill side by side. Which one says who is working?
- Lanes: what does a turn's lanes become once every agent finishes, and how do lanes fit three or more agents on desktop?
- Changed-file names alone mislead (`status.tsx` and `status.ts` in one turn). Collision flags and lane file lists need at least the parent folder.
- A remote-led thread has no machine, folder or branch for the quick card's top rows (Q31). The prototype shows the server and "No worktree until a local agent joins".
- Where does Connect live once remote agents leave Settings > Models? The prototype puts "Connect remote agent" beside New agent in Settings > Agents.
- The member list shows no Remove for the lead (Q5), and no way to seat without a message (Q8). B's "+ Agent" chip in screen 2 is one answer to Q8.
