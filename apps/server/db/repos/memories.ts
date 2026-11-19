import { randomUUID } from 'node:crypto';
import type { Memory, MemoryStatus } from '@omni/shared/memory.ts';
import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

// Omni's memory store (packages/shared/memory.ts): channel learnings (a channel, no role) and crew role memory (a role,
// and a channel when the lesson holds only there; crew plan S6).
// Every write records the row for sync (sync/handlers/memory.ts), where the newest write of the whole row wins.

export type { Memory };

const COLUMNS = 'id, channel_id, role, text, status, proposed_by, source_thread_id, created_at, updated_at, approved_at';

export const memories = {
  get: (id: string): Memory | null => (db.prepare(`SELECT ${COLUMNS} FROM memories WHERE id = ?`).get(id) as Memory | undefined) ?? null,

  /** A channel's own facts with no role: its Recent learnings, waiting and approved. */
  byChannel: (channelId: string): Memory[] =>
    db.prepare(`SELECT ${COLUMNS} FROM memories WHERE channel_id = ? AND role IS NULL ORDER BY created_at DESC, id`).all(channelId) as unknown as Memory[],

  /** The approved learnings a thread in this channel runs with. */
  approvedIn: (channelId: string): Memory[] =>
    db
      .prepare(`SELECT ${COLUMNS} FROM memories WHERE channel_id = ? AND role IS NULL AND status = 'approved' ORDER BY approved_at DESC, id`)
      .all(channelId) as unknown as Memory[],

  /** How many wait for the user in each channel. */
  waiting: (): Record<string, number> =>
    Object.fromEntries(
      (db.prepare(`SELECT channel_id AS c, COUNT(*) AS n FROM memories WHERE status = 'proposed' AND channel_id IS NOT NULL GROUP BY channel_id`).all() as { c: string; n: number }[]).map(
        (r) => [r.c, r.n],
      ),
    ),

  /** A crew role's lessons, in every channel, waiting and approved. */
  byRole: (role: string): Memory[] =>
    db.prepare(`SELECT ${COLUMNS} FROM memories WHERE role = ? ORDER BY created_at DESC, id`).all(role) as unknown as Memory[],

  /** The approved lessons a thread of this role runs with in this channel: the untagged ones and this channel's. */
  approvedForRole: (role: string, channelId: string): Memory[] =>
    db
      .prepare(`SELECT ${COLUMNS} FROM memories WHERE role = ? AND status = 'approved' AND (channel_id IS NULL OR channel_id = ?) ORDER BY approved_at DESC, id`)
      .all(role, channelId) as unknown as Memory[],

  /** How many lessons wait for the user, by crew role. */
  waitingByRole: (): Record<string, number> =>
    Object.fromEntries(
      (db.prepare(`SELECT role AS r, COUNT(*) AS n FROM memories WHERE status = 'proposed' AND role IS NOT NULL GROUP BY role`).all() as { r: string; n: number }[]).map((x) => [x.r, x.n]),
    ),

  create(fact: { channel_id: string | null; role?: string | null; text: string; status: MemoryStatus; proposed_by: 'user' | 'agent'; source_thread_id?: string | null }): Memory {
    return tx(() => {
      const id = randomUUID();
      const at = now();
      db.prepare(`INSERT INTO memories (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        fact.channel_id,
        fact.role ?? null,
        fact.text,
        fact.status,
        fact.proposed_by,
        fact.source_thread_id ?? null,
        at,
        at,
        fact.status === 'approved' ? at : null,
      );
      record('memory', id);
      return memories.get(id)!;
    });
  },

  /** New text, or approval. An approved fact stays approved when its text changes: the user wrote the new text. */
  update(id: string, change: { text?: string; approve?: boolean }): Memory | null {
    return tx(() => {
      const cur = memories.get(id);
      if (!cur) return null;
      const text = change.text ?? cur.text;
      // Editing a waiting proposal is the user's word on it, so it approves it too.
      const approve = change.approve || (change.text !== undefined && change.text !== cur.text);
      const status: MemoryStatus = approve ? 'approved' : cur.status;
      if (text === cur.text && status === cur.status) return cur;
      const at = now();
      db.prepare('UPDATE memories SET text = ?, status = ?, approved_at = ?, updated_at = ? WHERE id = ?').run(text, status, status === 'approved' ? (cur.approved_at ?? at) : null, at, id);
      record('memory', id);
      return memories.get(id)!;
    });
  },

  remove(id: string): boolean {
    return tx(() => {
      const res = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      if (res.changes) record('memory', id, 'delete');
      return res.changes > 0;
    });
  },
};
