import { publishFeed } from '../../bus.ts';
import { paths } from '../../config.ts';
import { CREW_ID, crewFiles, crewTexts, lockBreaks, removeOwnCrew, splitCrewFile, writeOwnCrew } from '../../crew.ts';
import { outbox, SEED_TS } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';
import { logRefused } from '../verify.ts';

// The user's crew files in data/crew/, by role id: a role of their own, or their overlay on a built-in. Last writer
// wins on the whole file. Only a file the clients wrote, reset or deleted (crew-store.ts) goes out; a hand edit stays on
// its machine until the next save in Omni. Hiding a built-in is per machine (data/omni.config.json) and does not sync.
// A crew file is a prompt every later thread of the role runs with, so it is a signed action entity (sync/verify.ts):
// only a trusted machine's applies. An overlay that breaks a lock on a built-in Omni relies on (crew.ts CREW_LOCKS) is
// refused here as a save of it is (crew-store.ts), whatever the other machine's build let through.

/**
 * Queue the crew files this machine already has, once: the ones written by hand before sync carried them. Each goes at
 * SEED_TS, so it lands only on a machine that has no file for that role. sync/worker.ts calls it after arming.
 */
export function seedCrewFiles() {
  outbox.seedOnce('sync.crew_files_seeded', 'crew_file', [...crewFiles(paths.personalCrew).keys()].filter((id) => CREW_ID.test(id)));
}

registerHandler('crew_file', {
  serialize(id) {
    const markdown = crewTexts(id).own;
    return markdown === null ? null : { markdown };
  },
  apply(change) {
    // The id becomes a file name: anything but a plain id is dropped.
    if (!CREW_ID.test(change.entity_id)) return false;
    // A seeded copy fills a gap only: it never replaces a file this machine has, synced or written by hand.
    if (change.ts === SEED_TS && change.op === 'upsert' && crewTexts(change.entity_id).own !== null) return false;
    if (change.op === 'delete') return claim(change) && removeOwnCrew(change.entity_id);
    const { markdown } = (change.data ?? {}) as { markdown?: unknown };
    if (typeof markdown !== 'string') return false;
    const { shipped } = crewTexts(change.entity_id);
    const breaks = shipped === null ? [] : lockBreaks(change.entity_id, splitCrewFile(shipped), splitCrewFile(markdown));
    if (breaks.length) {
      logRefused(change, `crew role ${change.entity_id}: ${breaks.map(([, why]) => why).join(' ')}`, false);
      return false;
    }
    if (!claim(change)) return false;
    writeOwnCrew(change.entity_id, markdown);
    return true;
  },
  notify() {
    // Roles are read from disk on every lookup, so nothing reloads. Open Settings and pickers refetch the list.
    publishFeed({ type: 'crew' });
  },
});
