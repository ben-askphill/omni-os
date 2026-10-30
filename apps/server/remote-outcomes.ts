// What the sender of a remote command (run-on.ts) shows once the command is answered: a message or report the holder
// did not take goes in the thread's transcript as not delivered, with why, and a Stop or limit action as an error line.
// Written once per command, by the machine that sent it, and synced like any event, so both machines show it.
import { publishThread } from './bus.ts';
import { db, events, type RemoteCommand } from './db.ts';

/** How long a holder has to take a command of each kind before either machine expires it. */
export const COMMAND_WINDOW_MS: Record<RemoteCommand['kind'], number> = {
  message: 24 * 60 * 60_000,
  report: 24 * 60 * 60_000,
  limit: 24 * 60 * 60_000,
  stop: 2 * 60_000,
};
const WINDOW_TEXT: Record<RemoteCommand['kind'], string> = { message: '24 hours', report: '24 hours', limit: '24 hours', stop: '2 minutes' };

/** Why an unanswered command expired, as the clients show it. */
export const expiryReason = (c: Pick<RemoteCommand, 'kind' | 'target_name'>) => `${c.target_name} did not take it within ${WINDOW_TEXT[c.kind]}.`;

const LIMIT_LABEL: Record<NonNullable<RemoteCommand['limit_action']>, string> = { resume: 'Resume', schedule: 'Resume at reset', cancel: 'Cancelling the scheduled resume' };

/** Add the outcome of a rejected or expired command to its thread's transcript, once. Nothing for one still open or accepted. */
export function recordOutcome(c: RemoteCommand) {
  if (c.state !== 'expired' && c.state !== 'rejected') return;
  if (db.prepare(`SELECT 1 FROM events WHERE thread_id = ? AND json_extract(payload, '$.command') = ? LIMIT 1`).get(c.thread_id, c.id)) return;
  const reason = c.reason ?? (c.state === 'expired' ? expiryReason(c) : `${c.target_name} refused it.`);
  let kind: string;
  let payload: Record<string, unknown>;
  if (c.kind === 'message') {
    kind = 'user';
    payload = { text: c.prompt, source: c.source ?? 'ben', ...(c.mode && { mode: c.mode }), ...(c.context?.length && { context: c.context }), dropped: true, undelivered: reason, command: c.id };
  } else if (c.kind === 'report') {
    kind = 'crew_report';
    payload = { ...(c.report ?? { text: c.prompt }), dropped: true, undelivered: reason, command: c.id };
  } else {
    kind = 'error';
    const what = c.kind === 'stop' ? 'Stop' : LIMIT_LABEL[c.limit_action ?? 'resume'];
    payload = { text: `${what} was not delivered to ${c.target_name}: ${reason}`, command: c.id };
  }
  publishThread(c.thread_id, events.add(c.thread_id, kind, payload));
}
