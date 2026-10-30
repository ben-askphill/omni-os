# Delivery contract

What Omni promises about a message, a wake or a Stop once it has said yes to it, wherever the thread runs. The local path keeps these promises today. Three cross-machine paths do not; each has an expected-fail test that flips when its fix lands.

## The contract

1. **Accepted means an outcome.** Once a client hears "accepted", the message ends in a terminal state someone can see: delivered, dropped, discarded or cancelled, or parked for Ben to decide (`recovered`, `uncertain`). No cap, age limit or restart removes it silently. Locally that is `message_requests` (`apps/server/db/repos/requests.ts`), written before the answer and moved through its states by the runner.
2. **One owner, checked where delivery happens.** At any moment one machine, or one remote provider, runs a thread. Ben's messages, Stop, run switches, crew reports, PR-watch wakes and limit resumes all go to that owner, or wait for Resume. The check is at the delivery boundary, not repeated in each caller, so a new path cannot skip it.
3. **A resume starts from the latest turns.** A process resumes a thread only on a session that holds every turn the previous owner synced. When the session cannot be brought here (`beforeResume` returns `failed` or `timed-out`), the turn does not start on the stale copy. Ben sees why, and can choose to start with fresh context.
4. **Stop is a command like any other.** It has an id and a durable receipt, and it reaches the turn that was running when Ben pressed it, not a later one.

## Where it does not hold yet

| Gap | Where | Test | Fixed by |
| --- | --- | --- | --- |
| 1. A forwarded reply has no outcome. The sender keeps its newest 50 per thread in one kv array, and the holder skips an entry older than 24 hours. Child reports and limit actions share that array. Stop is valid for 2 minutes and its receipt lives in memory. | `run-on.ts` `KEEP`, `FRESH_MS`, `STOP_FRESH_MS`, `stopped` | `apps/server/tests/delivery-gap-run-on.test.ts` | #398 |
| 2. A PR watch wakes a thread on the machine that polls it while another machine holds it between turns. `turnBlocked` refuses a remote running thread, not a remote idle holder. | `pr-watch/worker.ts` `deliver`, `sync/guard.ts` `turnBlocked` | `apps/server/tests/delivery-gap-pr-watch.test.ts` | #399 |
| 3. `spawnLive` ignores a failed or timed-out session download and resumes the stale session here. | `runner/spawn.ts` `spawnLive`, `sync/files.ts` `beforeResume` | `apps/server/tests/delivery-gap-stale-resume.test.ts` | #400 |

## The expected-fail tests

- Each is a vitest `it.fails`: it passes while the gap is there, so CI stays green.
- It asserts the contract, not today's behaviour, so the fix makes the assertions pass and `it.fails` then reports a failure. The fixing PR turns it into a plain `it` and moves its row out of the table above.
- The gap 1 test checks the outcome on the holder, as a message request. If #398 records an expired reply in its own state rather than as a request, it checks that state instead.
