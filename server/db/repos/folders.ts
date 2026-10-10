import { randomUUID } from 'node:crypto';
import { db, now, tx } from '../connection.ts';

/**
 * A folder groups a channel's threads in the sidebar. It belongs to exactly one channel; a thread sits in at most
 * one folder (threads.folder_id). One level for now: parent_id is always null, kept so nesting can come later.
 * Local to this Mac: folders and the folder a thread sits in are not synced.
 */
export interface Folder {
  id: string;
  channel_id: string;
  parent_id: string | null;
  name: string;
  /** Manual order once Ben drags a folder. Null while the channel's folders sort by name. */
  position: number | null;
  /** 1 while the sidebar shows the folder closed. */
  collapsed: number;
  created_at: string;
  updated_at: string;
}

export const FOLDER_NAME_MAX = 60;
export const DEFAULT_FOLDER_NAME = 'New folder';

/** A refused folder write, with the HTTP status the API answers it with. */
export class FolderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/** One line, trimmed, 1 to 60 characters. */
export function folderName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new FolderError('a folder name is required');
  if ([...name].length > FOLDER_NAME_MAX) throw new FolderError(`a folder name can be up to ${FOLDER_NAME_MAX} characters`);
  return name;
}

const fold = (s: string) => s.toLocaleLowerCase();

/** Manually placed folders first, in their order, then the rest by name. */
const ORDER = `ORDER BY position IS NULL, position, name COLLATE NOCASE, created_at`;

/** `base`, or `base 2`, `base 3`… : the first name no other folder in the channel has, ignoring case. */
function freeName(channelId: string, base: string, exceptId?: string) {
  const taken = new Set(folders.byChannel(channelId).filter((f) => f.id !== exceptId).map((f) => fold(f.name)));
  if (!taken.has(fold(base))) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const head = [...base].slice(0, FOLDER_NAME_MAX - suffix.length).join('').trimEnd();
    if (!taken.has(fold(head + suffix))) return head + suffix;
  }
}

const insert = (f: Omit<Folder, 'created_at' | 'updated_at'>) => {
  const ts = now();
  db.prepare(
    'INSERT INTO folders (id, channel_id, parent_id, name, position, collapsed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(f.id, f.channel_id, f.parent_id, f.name, f.position, f.collapsed, ts, ts);
  return folders.get(f.id)!;
};

const mustGet = (id: string) => {
  const f = folders.get(id);
  if (!f) throw new FolderError('folder not found', 404);
  return f;
};

export const folders = {
  get: (id: string) => db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as Folder | undefined,
  byChannel: (channelId: string) =>
    db.prepare(`SELECT * FROM folders WHERE channel_id = ? ${ORDER}`).all(channelId) as unknown as Folder[],
  all: () => db.prepare(`SELECT * FROM folders ${ORDER}`).all() as unknown as Folder[],
  /** A folder by id, or by name in the channel ignoring case. What `delegate`'s folder param names. */
  find(channelId: string, idOrName: string) {
    const byId = folders.get(idOrName);
    if (byId?.channel_id === channelId) return byId;
    const name = idOrName.replace(/\s+/g, ' ').trim();
    return folders.byChannel(channelId).find((f) => fold(f.name) === fold(name));
  },

  /** A new folder in the channel. A name another folder has gets a number. Lands last once the channel has a manual order. */
  create(input: { channel_id: string; name?: string | null; parent_id?: string | null }) {
    if (input.parent_id) throw new FolderError('folders inside folders are not supported yet');
    return tx(() => {
      if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(input.channel_id)) throw new FolderError('channel not found', 404);
      const name = freeName(input.channel_id, folderName(input.name ?? DEFAULT_FOLDER_NAME));
      const { max } = db.prepare('SELECT MAX(position) AS max FROM folders WHERE channel_id = ?').get(input.channel_id) as { max: number | null };
      return insert({ id: randomUUID(), channel_id: input.channel_id, parent_id: null, name, position: max === null ? null : max + 1, collapsed: 0 });
    });
  },

  /** Rename. Refused when another folder in the channel already has the name, ignoring case. */
  rename(id: string, raw: string) {
    return tx(() => {
      const f = mustGet(id);
      const name = folderName(raw);
      if (freeName(f.channel_id, name, id) !== name) throw new FolderError(`a folder named "${name}" already exists here`, 409);
      db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
      return folders.get(id)!;
    });
  },

  setCollapsed(id: string, collapsed: boolean) {
    mustGet(id);
    db.prepare('UPDATE folders SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id);
    return folders.get(id)!;
  },

  /**
   * "<name> copy" in the same channel, right after the original when the channel has a manual order. Settings only:
   * a thread sits in one folder, so the copy starts empty.
   */
  duplicate(id: string) {
    return tx(() => {
      const f = mustGet(id);
      const base = [...f.name].slice(0, FOLDER_NAME_MAX - ' copy'.length).join('').trimEnd() + ' copy';
      let position: number | null = null;
      if (f.position !== null) {
        position = f.position + 1;
        db.prepare('UPDATE folders SET position = position + 1 WHERE channel_id = ? AND position >= ?').run(f.channel_id, position);
      }
      return insert({ id: randomUUID(), channel_id: f.channel_id, parent_id: f.parent_id, name: freeName(f.channel_id, base), position, collapsed: f.collapsed });
    });
  },

  /** Delete the folder. Its threads stay, back in the channel's ungrouped list. Returns how many moved out. */
  remove(id: string) {
    return tx(() => {
      mustGet(id);
      const moved = db.prepare('UPDATE threads SET folder_id = NULL WHERE folder_id = ?').run(id).changes;
      db.prepare('DELETE FROM folders WHERE id = ?').run(id);
      return Number(moved);
    });
  },

  /** Ben's manual order: every folder of the channel, each once. From now on new folders land last. */
  reorder(channelId: string, ids: string[]) {
    return tx(() => {
      const mine = folders.byChannel(channelId).map((f) => f.id);
      if (ids.length !== mine.length || new Set(ids).size !== ids.length || !ids.every((id) => mine.includes(id)))
        throw new FolderError("the order has to list each of the channel's folders once");
      const set = db.prepare('UPDATE folders SET position = ? WHERE id = ?');
      ids.forEach((id, i) => set.run(i, id));
      return folders.byChannel(channelId);
    });
  },

  /**
   * Put a thread in a folder of its own channel, or back in the ungrouped list with null. Not an edit to the thread:
   * updated_at stays, so lists keep their order, and sync never hears of it.
   */
  moveThread(threadId: string, folderId: string | null) {
    return tx(() => {
      const t = db.prepare('SELECT channel_id FROM threads WHERE id = ?').get(threadId) as { channel_id: string } | undefined;
      if (!t) throw new FolderError('thread not found', 404);
      if (folderId !== null) {
        const f = mustGet(folderId);
        if (f.channel_id !== t.channel_id) throw new FolderError("a thread can only go in a folder of its own channel");
      }
      db.prepare('UPDATE threads SET folder_id = ? WHERE id = ?').run(folderId, threadId);
    });
  },
};
