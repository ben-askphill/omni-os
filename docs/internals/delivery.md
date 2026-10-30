# Delivery contract

What Omni promises about a message, a wake or a Stop once it has said yes to it, wherever the thread runs. The local path keeps these promises, and so does a message, crew report, limit action or Stop sent to the machine running a thread (#398). Two cross-machine paths do not yet; each has an expected-fail test that flips when its fix lands.

## The contract

1. **Accepted means an outcome.** Once a client hears "accepted", the message ends in a terminal state someone can see: delivered, dropped, discarded or cancelled, or parked for Ben to decide (`recovered`, `uncertain`). No cap, age limit or restart removes it silently. Locally that is `message_requests` (`apps/server/db/repos/requests.ts`), written before the answer and moved through its states by the runner. Across machines it is a remote command (`apps/server/db/repos/remote-commands.ts`): one synced row per forwarded message, crew report, limit action and Stop, written before the sender answers "accepted". The holder answers it `accepted` or `rejected` with why; one it finds past its deadline (24 hours, 2 minutes for a Stop) it marks `expired`, and the sender expires its own a minute after that when no holder answered. A row only moves forward, so an acceptance beats an expiry from either side. The sender writes a rejected or expired outcome into the transcript (`apps/server/remote-outcomes.ts`): a message or report as not delivered with the reason, a Stop or limit action as an error line.
2. **One owner, checked where delivery happens.** At any moment one machine, or one remote provider, runs a thread. Ben's messages, Stop, run switches, crew reports, PR-watch wakes and limit resumes all go to that owner, or wait for Resume. The check is at the delivery boundary, not repeated in each caller, so a new path cannot skip it.
3. **A resume starts from the latest turns.** A process resumes a thread only on a session that holds every turn the previous owner synced. When the session cannot be brought here (`beforeResume` returns `failed` or `timed-out`), the turn does not start on the stale copy. Ben sees why, and can choose to start with fresh context.
4. **Stop is a command like any other.** It has an id and a durable receipt, and it reaches the turn that was running when Ben pressed it, not a later one. Across machines a Stop is a remote command with a two-minute deadline: the holder stops the turn it finds running and answers `accepted`, or answers `rejected` when nothing runs. It does not yet name the turn Ben pressed it on, so a turn that starts within those two minutes can be the one stopped.

## Where it does not hold yet

| Gap | Where | Test | Fixed by |
| --- | --- | --- | --- |
| 2. A PR watch wakes a thread on the machine that polls it while another machine holds it between turns. `turnBlocked` refuses a remote running thread, not a remote idle holder. | `pr-watch/worker.ts` `deliver`, `sync/guard.ts` `turnBlocked` | `apps/server/tests/delivery-gap-pr-watch.test.ts` | #399 |
| 3. `spawnLive` ignores a failed or timed-out session download and resumes the stale session here. | `runner/spawn.ts` `spawnLive`, `sync/files.ts` `beforeResume` | `apps/server/tests/delivery-gap-stale-resume.test.ts` | #400 |

## The expected-fail tests

- Each is a vitest `it.fails`: it passes while the gap is there, so CI stays green.
- It asserts the contract, not today's behaviour, so the fix makes the assertions pass and `it.fails` then reports a failure. The fixing PR turns it into a plain `it` and moves its row out of the table above.
- The gap 1 test (`apps/server/tests/delivery-gap-run-on.test.ts`) is a plain `it` since #398: it checks each reply's command on both machines, the holder's expiry of a day-old one, the hub's own expiry when the holder never answers, and a rejected Stop.
