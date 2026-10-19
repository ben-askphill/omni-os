import { publishFeed } from '../../bus.ts';
import { db, folders, type Folder } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';

// Sidebar folders: last writer wins on the whole row, all but collapsed, which is each Mac's own view and stays as
// this Mac has it. Which folder a thread sits in travels with the thread (handlers/thread.ts); a thread that came
// before its folder waits in sync_folder_wait, and the folder's arrival files it. A delete moves the folder's threads
// back to the ungrouped list, as deleting it here does.

const COLUMNS = ['id', 'channel_id', 'parent_id', 'name', 'position', 'created_at', 'updated_at'] as const;

const upsert = db.prepare(
  `INSERT INTO folders (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
);

/** The channel each applied change touched, for notify: a deleted folder's row is gone by then. */
const channelOf = new Map<string, string>();

registerHandler('folder', {
  serialize(id) {
    const f = folders.get(id);
    if (!f) return null;
    const { collapsed: _, ...row } = f;
    return row;
  },
  apply(change) {
    if (!claim(change)) return false;
    const here = folders.get(change.entity_id);
    if (change.op === 'delete') {
      db.prepare('DELETE FROM sync_folder_wait WHERE folder_id = ?').run(change.entity_id);
      if (!here) return false;
      db.prepare('UPDATE threads SET folder_id = NULL WHERE folder_id = ?').run(change.entity_id);
      db.prepare('DELETE FROM folders WHERE id = ?').run(change.entity_id);
      channelOf.set(change.entity_id, here.channel_id);
      return true;
    }
    const f = { parent_id: null, position: null, created_at: change.ts, updated_at: change.ts, ...here, ...(change.data as Partial<Folder>), id: change.entity_id } as Omit<Folder, 'collapsed'>;
    // A channel not here yet fails the insert, and the change waits in sync_deferred until it comes.
    upsert.run(...COLUMNS.map((c) => (f[c] ?? null) as string | number | null));
    // A folder that moved channel takes none of the other channel's threads with it.
    if (here && here.channel_id !== f.channel_id)
      db.prepare('UPDATE threads SET folder_id = NULL WHERE folder_id = ? AND channel_id != ?').run(f.id, f.channel_id);
    db.prepare(
      `UPDATE threads SET folder_id = ?1 WHERE channel_id = ?2 AND id IN (SELECT thread_id FROM sync_folder_wait WHERE folder_id = ?1)`,
    ).run(f.id, f.channel_id);
    db.prepare('DELETE FROM sync_folder_wait WHERE folder_id = ?').run(f.id);
    channelOf.set(change.entity_id, f.channel_id);
    return true;
  },
  notify(change) {
    // Folders come with the channel list: open sidebars refetch it, as after a folder edit here.
    const channel = channelOf.get(change.entity_id);
    channelOf.delete(change.entity_id);
    if (channel) publishFeed({ type: 'channel', id: channel });
  },
});
