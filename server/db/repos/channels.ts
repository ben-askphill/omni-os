import { db, tx } from '../connection.ts';
import { record } from '../sync.ts';

export type ChannelKind = 'client' | 'internal' | 'personal' | 'system';

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  repo_path: string | null;
  github_repo: string | null;
  use_worktree: number;
  base_dir: string | null;
  store_domain: string | null;
  portal_slug: string | null;
  browser_headless: number;
  notes: string | null;
  /** One emoji, or `icon:<name>` for a design system icon (shared/channel-icon.ts), shown in place of the letter avatar and the sidebar's #. */
  icon: string | null;
  /** A standalone HTML file the channel's threads follow for the pages they write. Kept out of the API: see publicChannel. */
  design_system: string | null;
  design_system_name: string | null;
  archived: number;
  created_at: string;
}

/** The two system channels every install needs. Raw SQL, so seeding does not queue an outbox row. */
export function seedSystemChannels() {
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name, kind, use_worktree, notes) VALUES
     ('conductor', 'Conductor', 'system', 0, 'Front agent. Delegates to crew threads in other channels.'),
     ('inbox', 'Inbox', 'internal', 0, 'Default channel for quick asks, research and ops.')`,
  ).run();
}

export const channels = {
  list: (includeArchived = false) =>
    db
      .prepare(`SELECT * FROM channels ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY kind = 'system' DESC, name`)
      .all() as unknown as Channel[],
  get: (id: string) => db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as Channel | undefined,
  create(c: Partial<Channel> & { id: string; name: string }) {
    return tx(() => {
      db.prepare(
        `INSERT INTO channels (id, name, kind, repo_path, github_repo, use_worktree, base_dir, store_domain, portal_slug, browser_headless, notes, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        c.id,
        c.name,
        c.kind ?? 'client',
        c.repo_path ?? null,
        c.github_repo ?? null,
        c.use_worktree ?? 1,
        c.base_dir ?? null,
        c.store_domain ?? null,
        c.portal_slug ?? null,
        c.browser_headless ?? 1,
        c.notes ?? null,
        c.icon ?? null,
      );
      record('channel', c.id);
      return channels.get(c.id)!;
    });
  },
  update(id: string, patch: Partial<Channel>) {
    const allowed = [
      'name', 'kind', 'repo_path', 'github_repo', 'use_worktree', 'base_dir',
      'store_domain', 'portal_slug', 'browser_headless', 'notes', 'icon', 'design_system', 'design_system_name', 'archived',
    ] as const;
    const keys = allowed.filter((k) => k in patch);
    if (keys.length) {
      tx(() => {
        db.prepare(`UPDATE channels SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
          ...keys.map((k) => (patch[k] ?? null) as string | number | null),
          id,
        );
        record('channel', id);
      });
    }
    return channels.get(id);
  },
};

/** The channel as the API sends it: the design system's name and size, never the file, which can be large. */
export function publicChannel<T extends Channel>({ design_system, ...rest }: T) {
  return { ...rest, design_system_size: design_system ? Buffer.byteLength(design_system) : 0 };
}
