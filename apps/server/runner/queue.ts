// Who runs next: deliver a message, take a free slot, start the turn.
import { resolveDelivery } from '../delivery.ts';
import { events, messageRequests, outbox, requestFingerprint, threads, tx, type MessageRequest } from '../db.ts';
import { publishThread } from '../bus.ts';
import { clearSuggestion } from './aux.ts';
import { hardKill, requestInterrupt, stopStartup } from './session.ts';
import { launch } from './spawn.ts';
import { applyQueued, queuedRun } from './switch.ts';
import { userName } from '../profile.ts';
import { forwardReport } from '../run-on.ts';
import { startTurnSnapshot } from './snapshots.ts';
import {
  capFor,
  deliveryPhase,
  emitThread,
  deliveryCaps,
  isShuttingDown,
  lives,
  requestMsg,
  runningByHarness,
  send,
  track,
  waiting,
  waitingMsgs,
  type Msg,
} from './state.ts';

// ---------- queue ----------

export function deliver(threadId: string, m: Msg) {
  if (isShuttingDown()) throw new Error('Omni is shutting down');
  clearSuggestion(threadId);
  // The thread moves on: a limit stop it had, and the continuation scheduled for it, no longer apply (limits.ts).
  if (threads.get(threadId)?.limit_state) threads.setLimit(threadId, null);
  let live = lives.get(threadId);
  const caps = deliveryCaps(threadId);
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
    // A switch waits for this turn to end, and a message sent now goes on the new run: it waits for the turn too.
    if (queuedRun(threads.get(threadId)) && (action === 'steer' || action === 'interrupt')) {
      live.held.push(m);
      track(m, 'held');
      if (action === 'interrupt') requestInterrupt(live);
      return emitThread(threadId);
    }
    switch (action) {
      case 'queue':
        live.held.push(m);
        track(m, 'held');
        break;
      case 'kill':
        live.held.push(m);
        track(m, 'held');
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
    track(m, 'waiting');
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
    // A switch Ben queued applies first. Its old process is still exiting, or the switch closed it: start fresh once it is gone.
    if (!applyQueued(id) || lives.get(id)?.closing) {
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
    startTurnSnapshot(warm);
    send(warm, first);
  } else if (!launch(threadId, first)) return;
  for (const m of rest) deliver(threadId, m);
  emitThread(threadId);
}

/**
 * Save a message Omni writes to a thread itself (a crew report, a team's go) before anything is woken, keyed so the
 * same report or go is saved once whatever calls this again. Null when that key was saved before: it was handled.
 */
export function saveOwn(
  threadId: string,
  key: string,
  m: Pick<MessageRequest, 'prompt' | 'kind' | 'payload' | 'source'> & {
    mode?: MessageRequest['mode'];
    context?: MessageRequest['context'];
    attachments?: MessageRequest['attachments'];
  },
): MessageRequest | null {
  const mode = m.mode ?? 'steer';
  const attachments = m.attachments?.length ? m.attachments : null;
  const files = (attachments ?? []).map((a) => ({ name: a.name, size: a.size, sha256: '' }));
  const { row, fresh } = messageRequests.accept({
    thread_id: threadId,
    request_id: key,
    ...m,
    mode,
    attachments,
    fingerprint: requestFingerprint({ prompt: m.prompt, mode, source: m.source, files, context: m.context ?? undefined }),
    machine_id: outbox.machineId(),
  });
  return fresh ? row : null;
}

/** Hand a saved message to the runner. While Omni shuts down it is parked for Resume after the restart instead. */
export function wake(r: MessageRequest) {
  if (isShuttingDown()) {
    messageRequests.park(r.id);
    return emitThread(r.thread_id);
  }
  deliver(r.thread_id, requestMsg(r));
}

/**
 * A child's turn ended: report to its parent. The report is saved for the parent first, keyed by the child and
 * where its transcript stood (`completion`), so a restart before the parent reads it keeps it for Resume, and a
 * second call for the same completion reports nothing more. A parent Ben stopped keeps the report for Resume
 * instead of being woken by it.
 */
export function reportToParent(childId: string, status: string, text: string, completion = events.lastId(childId)) {
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
  // A lead that has not run yet waits for its whole team, then runs once with every report.
  const waitingLead = child.source === 'team' && !parent.has_run && !lives.has(parent.id) && !waiting.includes(parent.id);
  if (!waitingLead && status === 'stopped') return;
  const prompt =
    `[crew report] task ${child.task_id ?? '(none)'} from ${child.role ?? 'crew'} in #${child.channel_id} ` +
    `(thread ${child.id}), status: ${status}\n\n${report.text}\n\n` +
    `Relay what matters to ${userName()} in one short update. Delegate follow-ups if needed. Do not redo the work.`;
  const key = `crew-report:${child.id}:${completion}`;
  if (waitingLead) return teamReported(parent.id, key, prompt, report);
  // The parent runs on another machine (a delegation sent elsewhere, run-on.ts): the report goes to it there.
  const holder = threads.holder(parent.id);
  const self = outbox.machineId();
  if (holder && self && holder !== self) return forwardReport(parent.id, key, prompt, report);
  fileReport(parent.id, key, prompt, report);
}

/**
 * A child's report, saved for its parent on this machine and sent: woken, or steered in when the parent is busy. Here,
 * or on the machine that holds the parent when the child ran elsewhere (run-on.ts). A report saved before is not sent
 * again.
 */
export function fileReport(parentId: string, key: string, prompt: string, report: Record<string, unknown>) {
  const parent = threads.get(parentId);
  if (!parent) return;
  const row = saveOwn(parent.id, key, { prompt, kind: 'crew_report', payload: report, source: 'crew' });
  if (!row) return;
  // Ben stopped the parent: the report waits for him rather than starting it again. A parent whose worktree is not
  // ready keeps it too, and Retry sends it once the worktree is made.
  if (parent.setup || (parent.status === 'stopped' && !lives.get(parent.id)?.turn && !waiting.includes(parent.id))) {
    messageRequests.mark(row.id, 'recovered');
    return emitThread(parent.id);
  }
  // Wake the parent, or steer it if busy, exactly like a crewmate messaging firstmate.
  wake(row);
}

/**
 * A member's report reaches a lead that is still waiting. It shows in the lead's transcript at once, saved together
 * with its request row as delivered; the last one starts the lead's first turn with the brief and every member's
 * reply. A stopped lead stays stopped.
 */
function teamReported(leadId: string, key: string, prompt: string, report: Record<string, unknown>) {
  const row = tx(() => {
    const saved = saveOwn(leadId, key, { prompt, kind: 'crew_report', payload: report, source: 'crew' });
    if (!saved) return null;
    const ev = events.add(leadId, 'crew_report', report);
    messageRequests.mark(saved.id, 'delivered', ev.id);
    return ev;
  });
  if (!row) return;
  publishThread(leadId, row);
  emitThread(leadId);
  settleTeam(leadId);
}

/** Leads whose members are still being created. */
export const assembling = new Set<string>();

/**
 * Start a waiting lead's turn once no member is queued or running. The go is saved first, once per lead. A lead whose
 * worktree is not ready waits: its setup settles the team once the worktree is made.
 */
export function settleTeam(leadId: string) {
  const lead = threads.get(leadId);
  if (!lead || lead.has_run || assembling.has(leadId) || lead.setup) return;
  const team = threads.team(leadId);
  if (team.some((m) => m.status === 'running' || m.status === 'queued')) return;
  if (lead.status !== 'running') return;
  const brief = (events.firstUserText(leadId) ?? '').trim();
  const replies = team.map(
    (m) =>
      `### ${m.task_id ?? m.id} · ${m.title} (${m.role ?? 'crew'}, thread ${m.id}), status: ${m.status}\n\n` +
      (events.lastRunText(m.id) || m.last_text || '(no reply)'),
  );
  const said = `All ${team.length} reports are in.`;
  const row = saveOwn(leadId, `team-settle:${leadId}`, {
    prompt: `${brief}\n\n## Your team's reports\n\n${replies.join('\n\n')}\n\n${said} Combine them into one answer. Do not redo their work.`,
    kind: 'user',
    payload: { text: said, source: 'team' },
    source: 'team',
  });
  if (row) wake(row);
}
