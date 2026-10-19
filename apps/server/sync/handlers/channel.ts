import { publishFeed } from '../../bus.ts';
import { channels, db, type Channel } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';
import { fromPortable, safeSegment, toRemote } from '../paths.ts';

// Channels: last writer wins on the whole row. repo_path and base_dir travel with the home dir as "~", through
// each Mac's path map. A folder that is not on this Mac is fine: new threads fall back as prepareWorkdir does.
// A column the change does not carry (a Mac on an older build sent it) keeps the value this Mac has, so an older
// Mac editing a channel never clears a newer column such as the icon.

const COLUMNS = [
  'id', 'name', 'kind', 'repo_path', 'github_repo', 'use_worktree', 'base_dir', 'store_domain', 'portal_slug',
  'browser_headless', 'notes', 'icon', 'design_system', 'design_system_name', 'archived', 'created_at',
  'default_harness', 'default_model', 'default_effort',
] as const;
const PATHS = new Set<string>(['repo_path', 'base_dir']);

const upsert = db.prepare(
  `INSERT INTO channels (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
);

registerHandler('channel', {
  serialize(id) {
    const ch = channels.get(id);
    return ch ? { ...ch, repo_path: toRemote(ch.repo_path), base_dir: toRemote(ch.base_dir) } : null;
  },
  apply(change) {
    // Channel ids end up in secret scopes and folder names: one that is not a plain name is dropped.
    if (!safeSegment(change.entity_id) || !claim(change)) return false;
    // Nothing deletes a channel today. One that still has threads here fails on them and waits in sync_deferred.
    if (change.op === 'delete') return db.prepare('DELETE FROM channels WHERE id = ?').run(change.entity_id).changes > 0;
    const data = (change.data ?? {}) as Partial<Channel>;
    const sent = (c: string) => Object.prototype.hasOwnProperty.call(data, c);
    const ch = {
      kind: 'client', use_worktree: 1, browser_headless: 1, archived: 0, created_at: change.ts,
      ...channels.get(change.entity_id), ...data, id: change.entity_id,
    } as Channel;
    upsert.run(
      ...COLUMNS.map((c) => {
        const v = (ch[c] ?? null) as string | number | null;
        // Only a path the change sent is portable: one kept from this Mac's row is already local.
        return PATHS.has(c) && sent(c) ? fromPortable(v as string | null) : v;
      }),
    );
    return true;
  },
  notify(change) {
    // Open sidebars refetch the channels, so a name or icon set on the other Mac shows without a restart.
    publishFeed({ type: 'channel', id: change.entity_id });
  },
});
