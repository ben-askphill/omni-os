import { db, isCommandAhead, outbox, remoteCommands, threads, type RemoteCommand } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { registerHandler } from '../apply.ts';
import { recordOutcome } from '../../remote-outcomes.ts';

// A command for a thread that runs on another machine (db/repos/remote-commands.ts), keyed by its id. Not last-writer-
// wins: the sender writes it as `sent`, the holder answers it, and a copy only moves a row forward (isCommandAhead), so a
// late push of the sender's `sent` never reopens an answered command, and an expiry never undoes an acceptance. One
// whose thread has not arrived yet waits in sync_deferred. On the machine that sent it, a terminal answer goes in the
// thread's transcript (remote-outcomes.ts).

type Data = RemoteCommand;

const KINDS = new Set(['message', 'report', 'limit', 'stop']);
const STATES = new Set(['sent', 'accepted', 'expired', 'rejected']);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);

registerHandler('remote_command', {
  serialize(id) {
    return remoteCommands.get(id) ?? null;
  },
  apply(change) {
    if (change.op === 'delete') return db.prepare('DELETE FROM remote_commands WHERE id = ?').run(change.entity_id).changes > 0;
    const d = (change.data ?? {}) as Partial<Data>;
    if (!isId(change.entity_id) || !KINDS.has(d.kind as string) || !STATES.has(d.state as string) || !isId(d.thread_id) || !isId(d.sender) || !isId(d.target)) return false;
    if (typeof d.expires_at !== 'string' || !d.expires_at) return false;
    if (!threads.get(d.thread_id)) throw new Error(`thread ${d.thread_id} not here yet`);
    const cur = db.prepare('SELECT state FROM remote_commands WHERE id = ?').get(change.entity_id) as { state: RemoteCommand['state'] } | undefined;
    if (!cur) {
      db.prepare(
        `INSERT INTO remote_commands (id, thread_id, kind, sender, target, target_name, prompt, mode, source, context, files, report_key, report, limit_action, state, reason, acked_by, created_at, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      ).run(
        change.entity_id, d.thread_id, d.kind!, d.sender, d.target, typeof d.target_name === 'string' ? d.target_name : d.target,
        typeof d.prompt === 'string' ? d.prompt : '', d.mode ?? null, d.source ?? null,
        Array.isArray(d.context) && d.context.length ? JSON.stringify(d.context) : null,
        Array.isArray(d.files) && d.files.length ? JSON.stringify(d.files) : null,
        d.report_key ?? null, d.report && typeof d.report === 'object' ? JSON.stringify(d.report) : null, d.limit_action ?? null,
        d.state!, d.reason ?? null, d.acked_by ?? null, d.created_at ?? change.ts, d.expires_at, d.updated_at ?? change.ts,
      );
      return true;
    }
    if (!isCommandAhead(d.state!, cur.state)) return false;
    db.prepare('UPDATE remote_commands SET state = ?, reason = ?, acked_by = ?, updated_at = ? WHERE id = ?').run(
      d.state!, d.reason ?? null, d.acked_by ?? change.machine_id, d.updated_at ?? change.ts, change.entity_id,
    );
    return true;
  },
  notify(change) {
    const c = remoteCommands.get(change.entity_id);
    if (!c) return;
    // The sender hears the answer: a message that was not taken goes in the transcript, marked not delivered.
    if (c.sender === outbox.machineId()) recordOutcome(c);
    const t = threads.get(c.thread_id);
    if (t) publishFeed({ type: 'thread', thread: t });
  },
});
