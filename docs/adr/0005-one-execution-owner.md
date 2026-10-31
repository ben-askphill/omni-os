# One execution owner per thread, checked where delivery happens

A thread runs on one machine at a time. Before this, four records said which: the runner's live registry, the thread row's `run_machine`, the kv key `handoff.holder.<thread>` and the kv key `runon.thread.<thread>`. Each path that delivered to a thread read its own mix of them (`runner/api.ts`, `db/repos/threads.ts`, `sync/guard.ts`, `pr-watch/worker.ts`), and a PR-watch wake read too few: it started a turn on the machine polling the PR while another machine held the thread between turns, forking the session.

## Decision

- **One record.** `assignments` (`apps/server/db/repos/assignments.ts`): per thread, the machine that holds it, a `generation` and a `routed` mark. Every write is `assignments.claim`: a turn starting here (the status write claims it), a handoff or Take over pickup, and the hub sending a new thread to run elsewhere (`routed`). A different machine is the next generation; the same machine again changes nothing.
- **Everything else derives from it.** The live registry is the runtime view of this machine's own assignments. `run_machine` stays on the thread row as the tag of the machine whose status write it is, for the status merge (ADR 0004) and the result trigger; delivery never reads it for ownership. `handoff.holder.<thread>` is written in step with the row for machines on an older build and read as theirs; `runon.thread.<thread>` is read, never written.
- **Synced by generation, not by clock.** The row is its own sync entity (`sync/handlers/assignment.ts`): the higher generation wins, a tie goes to the lower machine id, so every machine settles on the same owner and a late copy of an old owner never takes a thread back. The handoff records keep deciding who may write while a thread is on its way.
- **The check lives at the boundary.** `apps/server/ownership.ts` answers who owns a thread; `sync/guard.ts` turns that into the two refusals every path uses. `turnBlocked` refuses a turn while another machine runs the thread. `wakeBlocked` refuses one of Omni's own wakes (a PR watch, a crew report, a team's go) while another machine holds the thread at all, running or idle, and `runner/queue.ts wake` applies it, so a new wake path cannot skip it. Ben's messages, Stop, limit actions and crew reports for a `routed` or delegated thread go to the holder as remote commands (`ownership.ts remoteHolder`).
- **Generation fencing.** A process remembers the generation it started a turn on. Once the assignment moved on, by machine or generation, the process is stale: it gets no further message (`runner/queue.ts deliver`), and after each sync `fenceStale` stops a stale turn with an error line in the thread and closes a stale idle process. Handoff and Take over stop a turn before the thread moves, so the fence catches only a move this machine did not see: Ben replying on the other machine while this one was offline.

## May a disconnected machine start work?

Yes, for the threads it holds. An offline machine is still the owner of what it holds: a wake there (a PR watch it polls, a crew report, a scheduled limit resume) starts a turn there, and its results sync when it reconnects. What it may not do is start work on a thread it does not hold, and the boundary refuses that with the same records it would use online.

Ben may still bring an idle thread to the machine he is on by replying there or with Take over, as before (docs/user/sync.md); that is a new generation. If the offline machine was meanwhile running a turn in it, the fence stops that turn when the machine reconnects and the thread says so. That is the one place two machines can have run the same thread, and it is visible rather than silent.

No lease expires on its own. A thread stays with its owner until a turn, a pickup, a reply or Take over moves it, however long that owner is away. An expiring lease would move a thread off a machine that is merely asleep, and the handoff protocol's offer, reply and request already say who may act while a move is under way. Whether a thread whose owner is gone for good should be reclaimable without that owner (a forced Take over) is a separate decision, not taken here.

## Consequences

- Promise 2 of the delivery contract holds (`docs/internals/delivery.md`): a PR-watch wake for a thread another machine holds waits here for Resume, and Resume is Ben's deliberate reply, which brings the thread here.
- "Remote machine" and "remote provider" are different things. A thread on Hermes or Cursor Cloud (`harness/types.ts isProviderHarness`) has no local files anywhere, and still has an owner machine: the one that talks to the provider. The provider predicate decides about worktrees, browsers and MCP config; the assignment decides where messages go.
- `assignment` is a new relay entity: a relay set up from an older `0001_changes.sql` refuses it until the migration is run again, as for the entities before it.
