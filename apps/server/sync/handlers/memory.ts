import { parseMemoryText, type Memory } from '@omni/shared/memory.ts';
import { publishFeed } from '../../bus.ts';
import { db, memories } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';

// Memory facts (db/repos/memories.ts): last writer wins on the whole row, keyed by the fact's id. An approved fact is a
// prompt every later thread in its channel, or of its role, runs with, so it is a signed action entity (sync/verify.ts): only a trusted
// machine's applies. A row that does not parse is dropped, never written.

const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** The channel and role each applied change touched, for notify: a deleted fact's row is gone by then. */
const touched = new Map<string, { channel_id: string | null; role: string | null }>();

registerHandler('memory', {
  serialize(id) {
    return memories.get(id);
  },
  apply(change) {
    const id = change.entity_id;
    if (change.op === 'delete') {
      const here = memories.get(id);
      if (!claim(change) || !here) return false;
      db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      touched.set(id, { channel_id: here.channel_id, role: here.role });
      return true;
    }
    const d = (change.data ?? {}) as Partial<Record<keyof Memory, unknown>>;
    const text = parseMemoryText(d.text);
    if (!text.ok || (d.status !== 'proposed' && d.status !== 'approved') || (d.proposed_by !== 'user' && d.proposed_by !== 'agent')) return false;
    if (!claim(change)) return false;
    const created = isTime(d.created_at) ? d.created_at : change.ts;
    db.prepare(
      `INSERT INTO memories (id, channel_id, role, text, status, proposed_by, source_thread_id, created_at, updated_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, role = excluded.role, text = excluded.text, status = excluded.status,
         proposed_by = excluded.proposed_by, source_thread_id = excluded.source_thread_id, created_at = excluded.created_at,
         updated_at = excluded.updated_at, approved_at = excluded.approved_at`,
    ).run(
      id,
      strOrNull(d.channel_id),
      strOrNull(d.role),
      text.value,
      d.status,
      d.proposed_by,
      strOrNull(d.source_thread_id),
      created,
      isTime(d.updated_at) ? d.updated_at : created,
      d.status === 'approved' && isTime(d.approved_at) ? d.approved_at : d.status === 'approved' ? created : null,
    );
    touched.set(id, { channel_id: strOrNull(d.channel_id), role: strOrNull(d.role) });
    return true;
  },
  notify(change) {
    const was = touched.get(change.entity_id) ?? { channel_id: null, role: null };
    touched.delete(change.entity_id);
    publishFeed({ type: 'memory', ...was });
  },
});
