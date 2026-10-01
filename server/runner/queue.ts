// Who runs next: deliver a message, take a free slot, start the turn.
import { randomUUID } from 'node:crypto';
import { resolveDelivery } from '../delivery.ts';
import { threads } from '../db.ts';
import { clearSuggestion } from './aux.ts';
import { hardKill, requestInterrupt, stopStartup } from './session.ts';
import { launch } from './spawn.ts';
import {
  bindPump,
  bindReportToParent,
  capFor,
  deliveryPhase,
  emitThread,
  harnessSteers,
  isShuttingDown,
  lives,
  runningByHarness,
  send,
  waiting,
  waitingMsgs,
  type Msg,
} from './state.ts';

// ---------- queue ----------

export function deliver(threadId: string, m: Msg) {
  if (isShuttingDown()) throw new Error('Omni is shutting down');
  clearSuggestion(threadId);
  let live = lives.get(threadId);
  const caps = { steer: harnessSteers(threadId) };
  // Interrupt and send while the process is still starting: stop it like Interrupt does and start fresh with this message.
  if (live?.turn && !live.closing && resolveDelivery(m.mode, caps, deliveryPhase(live)) === 'stop-startup') {
    stopStartup(live);
    live = lives.get(threadId);
  }
  if (live?.turn && !live.closing) {
    // A harness that can't steer queues a steer, and stops the process on interrupt so the next
    // message resumes the session (there is no mid-turn control to send). Startup interrupts were
    // already stopped above, so this pass is the running decision.
    const action = resolveDelivery(m.mode, caps, 'running');
    switch (action) {
      case 'queue':
        live.held.push(m);
        break;
      case 'kill':
        live.held.push(m);
        hardKill(live);
        break;
      case 'steer':
        m.midTurn = true;
        send(live, m);
        break;
      case 'interrupt':
        m.midTurn = true;
        send(live, m);
        requestInterrupt(live);
        break;
      default: {
        const unreachable: never = action;
        throw new Error(unreachable);
      }
    }
  } else {
    if (m.mode === 'interrupt') m.mode = 'steer';
    const list = waitingMsgs.get(threadId) ?? [];
    list.push(m);
    waitingMsgs.set(threadId, list);
    if (!waiting.includes(threadId)) waiting.push(threadId);
    pump();
    if (waiting.includes(threadId)) threads.update(threadId, { status: 'queued' });
  }
  emitThread(threadId);
}

/** Concurrency is counted per harness; a full harness never blocks another. */
export function pump() {
  if (isShuttingDown()) return;
  const running = runningByHarness();
  for (let i = 0; i < waiting.length; ) {
    const id = waiting[i];
    // Its old process is still exiting; start fresh once it is gone.
    if (lives.get(id)?.closing) {
      i++;
      continue;
    }
    const harness = threads.get(id)?.harness ?? 'claude-code';
    // Harness at its cap: leave this thread queued and try others (arrival order within a harness).
    if ((running[harness] ?? 0) >= capFor(harness)) {
      i++;
      continue;
    }
    waiting.splice(i, 1);
    running[harness] = (running[harness] ?? 0) + 1;
    const msgs = waitingMsgs.get(id) ?? [];
    waitingMsgs.delete(id);
    if (msgs.length) begin(id, msgs);
  }
}

/** Start a turn with the first message; the rest follow as if sent mid-turn. */
function begin(threadId: string, [first, ...rest]: Msg[]) {
  const warm = lives.get(threadId);
  if (warm) {
    clearTimeout(warm.idleTimer);
    warm.turn = true;
    threads.update(threadId, { status: 'running' });
    send(warm, first);
  } else if (!launch(threadId, first)) return;
  for (const m of rest) deliver(threadId, m);
  emitThread(threadId);
}

export function reportToParent(childId: string, status: string, text: string) {
  const child = threads.get(childId)!;
  const parent = threads.get(child.parent_id!);
  if (!parent) return;
  const report = {
    text: text || '(no reply)',
    task_id: child.task_id,
    thread_id: child.id,
    title: child.title,
    role: child.role,
    channel: child.channel_id,
    status,
  };
  // Wake the parent, or steer it if busy, exactly like a crewmate messaging firstmate.
  deliver(parent.id, {
    uuid: randomUUID(),
    mode: 'steer',
    event: { kind: 'crew_report', payload: report },
    text:
      `[crew report] task ${child.task_id ?? '(none)'} from ${child.role ?? 'crew'} in #${child.channel_id} ` +
      `(thread ${child.id}), status: ${status}\n\n${report.text}\n\n` +
      'Relay what matters to Ben in one short update. Delegate follow-ups if needed. Do not redo the work.',
  });
}

bindPump(pump);
bindReportToParent(reportToParent);
