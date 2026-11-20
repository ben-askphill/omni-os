# PROTOTYPE: group threads (throwaway)

What should the agent UI look like for [ADR 0019](../../../../../docs/adr/0019-group-threads.md) (threads are group chats) and [ADR 0020](../../../../../docs/adr/0020-remote-agents-are-agents.md) (remote agents are agents)? Seven screens, two or three variants each, inside Omni's real channel rail and list panel. Nothing here is wired to a server. It lives only on the `prototype/group-threads` branch and is never merged.

## Run it

```sh
npm install --include=dev
npm run prototype          # vite on :4790, opens /prototype-group-threads.html
```

- The page draws the real `ChannelRail`, `ListPanel`, status marks and Settings parts on a fake `/api` (`fake-api.ts`, built on the recorded wire fixtures). Below 768px it draws each screen's phone version.
- The yellow bar switches screens and variants. Keys: `←` `→` variant, `[` `]` or `1` to `7` screen.
- Address: `?s=<screen>&v=<A|B|C>`, plus `tech=1` (Show technical details), `theme=dark`, `bar=0` (hide the bar), and per screen `closed=1` (screen 2, menu closed), `read=1` (screen 6, channel lets remote agents read files), `local=1` (screen 7, edit a local agent).
- Screenshots of every variant: `node apps/web/src/prototype/group-threads/capture.mjs <out dir>` with the server running (desktop 1440x900, phone 390x844).

## Screens and verdicts

| Screen | Variants | Pick |
| --- | --- | --- |
| 1 Group thread | A Gutter · B Byline · C Turn cards | B |
| 2 `@` agent mention | A One @ menu · B To line | A, with B's hint line |
| 3 Member list | A Header facepile · B Members strip · C Quick card | A |
| 4 Two running, collision | A Inline · B Lanes · C Dock | A |
| 5 Mark in the thread list | A Mark + faces · B Faces are the mark · C Second line | A on desktop, C on the phone |
| 6 Remote lead, talk only | A Quiet labels · B Notice card | A |
| 7 Settings > Agents | A Editor modal · B Agent page | A |

- **1 B Byline.** Replies keep the full width they have today, and it is the author line the phone already draws for the Conductor. A's gutter takes 40px from every reply; C's cards make every reply heavy and stack on top of the Steps card.
- **2 A One @ menu.** It is the `@` menu the composer has today, with agents on top: "In this thread" (reply) and "Add to this thread" (seat) tell the two apart. Take B's hint line under the composer ("Goes to Designer only. It joins this thread"), so Ben sees who gets a message before he sends it.
- **3 A Header facepile.** It is the same on desktop and phone, and stays in sight when the quick card is folded or the inspector is open. B costs a row on every thread and its Remove confirm does not fit a phone chip. C is a good second place on desktop: the quick card's Agent row turns into its Agents rows.
- **4 A Inline.** The collision stays in the transcript as a record after the turns end. B's lanes hide one agent behind a tab on the phone and get cramped past two agents. C's dock is the best live view (Stop per agent) but the flag goes when the turn ends; its per-agent Stop is worth keeping for Q13.
- **5 A Mark + faces.** The mark keeps its shapes (circle for an agent, diamond for Ben), and a thread that needs Ben while another agent runs still shows both. B drops the mark while agents work, and 16px faces do not read. C doubles the height of every desktop row; on the phone rows already have a second line, so C's words fit there.
- **6 A Quiet labels.** Each fact sits where it matters: "talks only" in the crumbs, a lock line under a reply that could not read files, a Files row in the quick card. B's card says it all at once but repeats on every visit. Put B's Add Builder action into A's lock line.
- **7 A Editor modal.** It is today's list and editor; the server as a fold at the editor's foot is exactly "a detail of the agent". B rebuilds Settings around agent pages, a bigger change than this needs.

## UI questions the prototype raised

- Initials collide. Reviewer and Researcher are both "RE" with `monogram()`. Channels get unique letters from `monograms()`; agents need the same, or Q4 covers initials as well as names.
- Two letters do not read below about 18px (facepiles, mention pills, list rows). The prototype draws one letter there.
- Nothing says who a message with no mention goes to. The phone placeholder "Reply to Builder" helps; the desktop placeholder needs the lead's name too.
- The composer's run pill shows one harness and model. With several agents, whose run is it, and can Ben switch one member's run from it (Q15)?
- Should seating write a line in the transcript ("You seated Reviewer and Hermes")? The ADR does not say. Without one, nothing marks when an agent joined.
- Agent mention pills use the machine pill's blue. Should agent and machine mentions look different?
- With Needs you and Working in one thread, the mark shows Needs you, so the running agents need a place of their own on the row (Q34, Q35).
- A remote-led thread has no machine, folder or branch for the quick card's top rows (Q31). What does the card show there?
- Changed-file names alone mislead (`status.tsx` and `status.ts` in one turn). Collision flags need at least the parent folder.
- The thread header shows "2 working" faces and the Working pill side by side. One of them is enough.
- Where does Connect live once remote agents leave Settings > Models? The prototype puts "Connect remote agent" beside New agent in Settings > Agents; the plan does not say.
- The member list shows no Remove for the lead (Q5), and no way to seat without a message (Q8). B's "+ Agent" chip in screen 2 is one answer to Q8.
