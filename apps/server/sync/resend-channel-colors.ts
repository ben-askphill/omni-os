import { db, kv, tx } from '../db.ts';
import { record } from '../db/sync.ts';

// Channel background colors (#612) went out to a Mac still on an older build. Its channel handler did not know
// avatar_bg, so it dropped the color but kept the change's claim, and the same change can never win there again.
// Once per sync id, queue every channel this Mac wrote last that has a color as a new write, so the other Mac,
// on a build that knows the column, takes it. A channel without a color is left alone: sending its null would clear
// a color the other Mac kept.

const DONE = 'sync.channel_colors_resent';

export function resendChannelColors(machineId: string) {
  if (kv.get<string>(DONE) === machineId) return;
  tx(() => {
    const ids = db
      .prepare(
        `SELECT c.id FROM channels c LEFT JOIN sync_meta m ON m.entity = 'channel' AND m.entity_id = c.id
         WHERE c.avatar_bg IS NOT NULL AND (m.machine_id IS NULL OR m.machine_id = ?) ORDER BY c.created_at, c.rowid`,
      )
      .all(machineId) as { id: string }[];
    for (const { id } of ids) record('channel', id);
    kv.set(DONE, machineId);
  });
}
