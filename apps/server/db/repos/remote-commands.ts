import { createHash } from 'node:crypto';
import type { MessageContext } from '@omni/shared/message-context.ts';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

// Commands for a thread that runs on another machine (apps/server/run-on.ts): Ben's replies and Stop, a delegated
// thread's report to its parent, and his actions on a usage-limit stop. One row each, written on the sender before
// it answers "accepted", and synced (sync/handlers/remote-command.ts). The holder answers each one: `accepted` (a
// message is saved there as a request, a Stop stopped the turn), `rejected` (with why), or `expired` (it came too
// late). A sender expires its own unanswered command after the same deadline, so none stays open for good, and the
// outcome goes in the thread's transcript (remote-outcomes.ts). A row only moves forward, and the holder's answer
// beats an expiry: it says what happened.

export type RemoteCommandKind = 'message' | 'report' | 'limit' | 'stop';
export type RemoteCommandState = 'sent' | 'accepted' | 'expired' | 'rejected';
export type RemoteLimitAction = 'resume' | 'schedule' | 'cancel';

/** A file the sender put in Storage for the holder to fetch (sync/files.ts UploadRef). */
export interface RemoteFile {
  name: string;
  sha: string;
  size: number;
  mime: string;
  image: boolean;
}

/** `accepted` is a fact (the holder has it) and beats an expiry either side wrote; nothing leaves a terminal state. */
export const COMMAND_RANK: Record<RemoteCommandState, number> = { sent: 0, expired: 1, rejected: 1, accepted: 2 };
export const isCommandAhead = (next: RemoteCommandState, cur: RemoteCommandState) => COMMAND_RANK[next] > COMMAND_RANK[cur];
export const COMMAND_KINDS: readonly RemoteCommandKind[] = ['message', 'report', 'limit', 'stop'];

export interface RemoteCommand {
  /** A message's is the client's request id, so a retry is the same command and the holder's request id is `runon:<id>`. */
  id: string;
  thread_id: string;
  kind: RemoteCommandKind;
  /** The machine that wrote it. */
  sender: string;
  /** The machine it was for: the holder as the sender knew it, and that machine's name, for the clients. */
  target: string;
  target_name: string;
  prompt: string;
  mode: 'steer' | 'queue' | 'interrupt' | null;
  source: 'ben' | 'conductor' | null;
  context: MessageContext[] | null;
  files: RemoteFile[] | null;
  /** A report: the key it is saved under on the holder, and its transcript payload. */
  report_key: string | null;
  report: Record<string, unknown> | null;
  limit_action: RemoteLimitAction | null;
  state: RemoteCommandState;
  /** Why it was rejected or expired. */
  reason: string | null;
  /** The machine that answered it. */
  acked_by: string | null;
  created_at: string;
  /** Not taken by then: expired, by whichever machine sees it first. */
  expires_at: string;
  updated_at: string;
}

type Row = Omit<RemoteCommand, 'context' | 'files' | 'report'> & { context: string | null; files: string | null; report: string | null };

const COLUMNS =
  'id, thread_id, kind, sender, target, target_name, prompt, mode, source, context, files, report_key, report, limit_action, state, reason, acked_by, created_at, expires_at, updated_at';

const parse = (r: Row | undefined): RemoteCommand | undefined =>
  r && {
    ...r,
    context: r.context ? (JSON.parse(r.context) as MessageContext[]) : null,
    files: r.files ? (JSON.parse(r.files) as RemoteFile[]) : null,
    report: r.report ? (JSON.parse(r.report) as Record<string, unknown>) : null,
  };
const list = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).all(...args) as unknown as Row[]).map((r) => parse(r)!);

/** A report's command id: the same report forwarded twice is one command. Letters and digits only, as every command id is. */
export const reportCommandId = (parentId: string, key: string) => createHash('sha256').update(`report\n${parentId}\n${key}`).digest('hex').slice(0, 32);

export type NewRemoteCommand = Pick<RemoteCommand, 'id' | 'thread_id' | 'kind' | 'sender' | 'target' | 'target_name' | 'expires_at'> &
  Partial<Pick<RemoteCommand, 'prompt' | 'mode' | 'source' | 'context' | 'files' | 'report_key' | 'report' | 'limit_action'>>;

export const remoteCommands = {
  /** Save one as sent. The same id again (a retried send, the same report) changes nothing and returns the first, with fresh false. */
  add(c: NewRemoteCommand): { command: RemoteCommand; fresh: boolean } {
    return tx(() => {
      const at = now();
      const fresh =
        db
          .prepare(`INSERT INTO remote_commands (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', NULL, NULL, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
          .run(
            c.id, c.thread_id, c.kind, c.sender, c.target, c.target_name, c.prompt ?? '', c.mode ?? null, c.source ?? null,
            c.context?.length ? JSON.stringify(c.context) : null, c.files?.length ? JSON.stringify(c.files) : null,
            c.report_key ?? null, c.report ? JSON.stringify(c.report) : null, c.limit_action ?? null, at, c.expires_at, at,
          ).changes > 0;
      if (fresh) record('remote_command', c.id);
      return { command: remoteCommands.get(c.id)!, fresh };
    });
  },

  get: (id: string) => parse(db.prepare(`SELECT ${COLUMNS} FROM remote_commands WHERE id = ?`).get(id) as Row | undefined),

  /** A thread's commands, newest first: the record of what was sent elsewhere and what came of it. */
  forThread: (threadId: string, limit = 100) => list(`SELECT ${COLUMNS} FROM remote_commands WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, threadId, limit),

  /** A thread's commands no machine has answered, oldest first: what the clients show as on their way. */
  open: (threadId: string) => list(`SELECT ${COLUMNS} FROM remote_commands WHERE thread_id = ? AND state = 'sent' ORDER BY created_at, id`, threadId),

  /** Every unanswered command, oldest first: what a holder acts on after a sync, and a sender expires when overdue. */
  pending: () => list(`SELECT ${COLUMNS} FROM remote_commands WHERE state = 'sent' ORDER BY created_at, id`),

  /**
   * Answer a command: accepted, rejected or expired, never back and never past a higher answer, so an expiry that
   * races the holder's acceptance loses on both machines. False when nothing changed.
   */
  settle(id: string, state: Exclude<RemoteCommandState, 'sent'>, by: string, reason: string | null = null): boolean {
    return tx(() => {
      const cur = remoteCommands.get(id);
      if (!cur || !isCommandAhead(state, cur.state)) return false;
      db.prepare('UPDATE remote_commands SET state = ?, reason = ?, acked_by = ?, updated_at = ? WHERE id = ?').run(state, reason, by, now(), id);
      record('remote_command', id);
      return true;
    });
  },

  /** How many of a thread's commands are still unanswered. */
  openCount: (threadId: string) => (db.prepare(`SELECT COUNT(*) AS n FROM remote_commands WHERE thread_id = ? AND state = 'sent'`).get(threadId) as { n: number }).n,
};
