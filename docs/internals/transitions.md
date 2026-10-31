# Transitions

How a thread changes how or where it runs, and the one service behind every way of doing it. The words are in
[CONTEXT.md](../../CONTEXT.md); who may run a thread at all is [ADR 0005](../adr/0005-one-execution-owner.md), what a
message is promised is the [delivery contract](delivery.md), and what owns a process is
[execution state](execution-state.md).

## The model

| Thing | What it is | Where |
| --- | --- | --- |
| Thread | The unit of work: a channel, a run (harness, model, effort), a session, a transcript | `db/repos/threads.ts` |
| Execution | The thread's process on the machine that holds it, and the assignment that says which machine that is | `runner/controller.ts`, `db/repos/assignments.ts` through `ownership.ts` |
| Checkpoint | A snapshot of the thread's checkout that another process can start from: a Continue's snapshot, a handoff's bundle, a turn snapshot | `checkpoint.ts`, `transcript-select.ts` |
| Command | Something sent to the machine that holds the thread, with a durable receipt: a message, a Stop, a crew report, a limit action | `db/repos/remote-commands.ts`, `run-on.ts` |
| Transition | A change to the thread's run or its execution, asked by Ben or the Conductor, with a preview, an id, a state and a cancel | `transition.ts`, `transitions-api.ts`, `db/repos/transitions.ts` |

A transition has one of three kinds:

| Kind | What changes | Done by | Its id | Its states |
| --- | --- | --- | --- | --- |
| `reconfigure` | The run: harness, model or effort. The thread stays where it is | `runner/switch.ts` (`switch-plan.ts` decides what happens to the sessions) | its own | `applied` at once between turns; `queued` during a turn, then `applied` when the turn ends, or `cancelled` once another pick replaced it, Ben cancelled it or the catalog no longer offered it |
| `relocate` | The machine: a handoff from this one (`to: <machine id>`), or a Take over of one another machine holds (`to: "here"`) | `handoff.ts` | the handoff record it wrote: the offer for a handoff, the request for a Take over | the handoff's phases: `preparing`, `offered`, `accepted`, `failed`, `declined`, `cancelled`; a request's `requested`, `expired` |
| `fork` | Nothing in the thread: a new thread continues it on another local run, with a Carryover (Continue) | `continue.ts` | the new thread's | `started`; from then on it is that thread |

The shapes are `packages/shared/transition.ts`.

## The routes

Four, under `/api/threads/:id/transitions`, the same for every kind:

| Operation | Route | Answers |
| --- | --- | --- |
| preview | `POST .../transitions/preview` | what the transition would do now and what keeps the thread from it (`blocked`). Nothing changes |
| create | `POST .../transitions` | the transition as it stands; a 409 with why it cannot start, a 400 for a run the catalog does not offer |
| read | `GET .../transitions/:tid` | the transition as it stands now |
| cancel | `POST .../transitions/:tid/cancel` | a queued reconfigure dropped, a relocate under way cancelled; a 409 for one that is over, or for a fork |

The six routes from before answer through the same service, in the shapes they always had, so the Web UI, the Mac
app, the Conductor and a machine on an older build keep working without a change:

| Older route | Is |
| --- | --- |
| `POST /:id/continue/preview` | preview of a `fork` |
| `POST /:id/continue` | create of a `fork` |
| `POST /:id/run` | create of a `reconfigure` |
| `POST /:id/handoff` | create of a `relocate` to a machine |
| `POST /:id/takeover` | create of a `relocate` to `here` |
| `POST /:id/handoff/cancel` | cancel of the thread's current `relocate` |

A refusal is the same whichever door it comes through: the ownership check at the delivery boundary
(`sync/guard.ts turnBlocked`), the handoff's refusals, Continue's `busy`, `changed` and `request_reused`.

## What each machine keeps

- `transitions` (`db/repos/transitions.ts`) is this machine's ledger: the transitions it created, with the id a client
  reads and cancels them by. It is local and never synced, so there is no sync handler and no relay entity for it. A
  transition's state comes from the records that own it on every read: a reconfigure's from the thread row's `queued_*`
  and run columns (the runner settles the ledger where it changes them), a relocate's from the handoff records, a fork's
  from the new thread. The other machine sees the move, never the transition: a read of one it did not create is a 404.
- The handoff records stay as synced kv (`handoff.offer.<thread>`, `handoff.reply.<thread>`,
  `handoff.request.<thread>`, `apps/server/handoff/records.ts`). They are the relocate's cross-machine state and what
  a Mac on an older build reads and writes, so they are not replaced by the ledger. The same holds for the older
  `runon.msgs.*` and `runon.stop.*` keys `run-on.ts` reads but never writes, and `handoff.holder.<thread>` written in
  step with the assignment ([ADR 0005](../adr/0005-one-execution-owner.md)). Each goes when every synced machine is on a
  build that no longer writes it.
- The planners stay with their kinds: `runner/switch-plan.ts` (what a switch does to the sessions),
  `continue.ts capture` (what a Continue carries), `handoff.ts giveAway` and `take` (what a handoff moves). They decide
  different things and share `transcript-select.ts` and `checkpoint.ts` for what they have in common; the service is
  the one front door, not a fourth planner.
