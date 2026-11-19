Ask is Ask from a thread on desktop web, phone web and the desktop app: the Ask chip over a reply box once a message starts with `@<role>`, the role rows the `@` menu adds at the start of a message, the Ask sheet the thread menu's **Ask a crew role…** opens, and a sent Ask in the transcript (`apps/web/src/components/AskCard.tsx`). It is composed of existing parts: `Toggle`, `Segmented` (small, radio), `Modal`, `Picker`, `Label`, `.field`, `RemoteMark` (ConnectAgent), `MoBubble` and the `Delegation` card.

```jsx
<AskChip threadId={id} role={{ id: 'hermes-box', name: 'Hermes on box', remote: true }} options={{ excerpt: true, wake: true }} onOptions={set} />
<AskSheet thread={thread} open onClose={close} />
<AskItem p={askEvent} byId={known} answer={shownReport} />
```

## Ask chip

- A `bg` card with the card shadow, inset 8px from the reply box's edges, above the context chips.
- First line: the message icon (14px, `fg-3`), **Ask <name>** (13px medium), `RemoteMark` for a remote role, then "instead of this thread's agent" in `fg-3`, so the change of target shows before send.
- Second line (12.5px `fg-2`): the excerpt `Toggle` with "Thread excerpt: last 12 of 40 messages, 3.1k characters" (struck through when off) and **Preview** (underlined), then a small radio `Segmented`: **Wake this thread** / **Just show it**. A channel that keeps excerpts from remote agents shows its reason in `fg-3` in place of the toggle.
- The send button reads **Ask** (desktop) or carries "Ask <name>" as its label (phone).

## @ menu rows

At the start of a message the `@` menu lists the roles first: the message icon, the name (13px medium), "Ask a remote agent" or "Ask a crew role" (11.5px `fg-3`), and an outlined **Remote** pill for a remote role. Files follow.

## Sent Ask

- Ben's question as a user bubble, with the caption over it: "Asked Hermes on box (remote) · with 12 messages of this thread · the answer wakes this thread".
- Under it the `Delegation` card with the role's mark and "Asked <name>" (plus `RemoteMark`) in its header, one row for the Ask's thread with its live state, and the answer under the row after **Just show it**. A woken answer is a `CrewReport` card, which names the remote server with `RemoteMark`.
- On the phone the same caption sits over a `MoBubble`, above the turn's delegation card.

Implementation: `apps/web/src/components/AskCard.tsx`, `apps/web/src/components/FileMenu.tsx`, `apps/web/src/components/Composer.tsx`, `apps/web/src/mobile/MoComposer.tsx`, `apps/web/src/mobile/ThreadTurn.tsx`; rules in `packages/shared/ask.ts`.
