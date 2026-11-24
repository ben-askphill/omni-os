import { CUSTOM_HARNESS_SLUG } from '@omni/shared/custom-harness.ts';
import { customHarness, customHarnessSlugs, customHarnessText, removeCustomHarness, writeCustomHarness } from '../../harness/custom.ts';
import { outbox, SEED_TS } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';

// The user's custom harness files in data/harnesses/, by slug (harness/custom.ts). Last writer wins on the whole file.
// Only a file the clients wrote or removed (harness/custom-store.ts) goes out; a hand edit stays on its machine until
// the next save in Omni. The secret a file names never syncs: each machine keeps its own value, and one without it
// shows the harness as unavailable, naming the secret.
// A harness file decides where every later thread of a role bound to it sends its brief, and which secret goes there,
// so it is a signed action entity (sync/verify.ts): only a trusted machine's applies. A file is checked again on every
// lookup on this machine, so one that breaks a rule (plain http:// off the tailnet, a reserved secret) never runs here.
// A paired agent keeps one key per machine (Pair this machine): a removal from another machine revokes this one's key
// and deletes the secret pairing made here, as Remove does on its own machine.

/** At most this much YAML per file. A harness file is a few lines. */
const MAX_TEXT = 16_000;

/**
 * Queue the harness files this machine already has, once: the ones written by hand before sync carried them. Each goes
 * at SEED_TS, so it lands only on a machine that has no file for that slug. sync/worker.ts calls it after arming.
 */
export function seedHarnessFiles() {
  outbox.seedOnce('sync.harness_files_seeded', 'harness_file', customHarnessSlugs());
}

registerHandler('harness_file', {
  serialize(slug) {
    const yaml = customHarnessText(slug);
    return yaml === null ? null : { yaml };
  },
  apply(change) {
    // The slug becomes a file name: anything but a plain slug is dropped.
    if (!CUSTOM_HARNESS_SLUG.test(change.entity_id)) return false;
    // A seeded copy fills a gap only: it never replaces a file this machine has, synced or written by hand.
    if (change.ts === SEED_TS && change.op === 'upsert' && customHarnessText(change.entity_id) !== null) return false;
    if (change.op === 'delete') {
      const before = customHarness(`custom:${change.entity_id}`);
      if (!claim(change) || !removeCustomHarness(change.entity_id)) return false;
      // Remove on another machine revoked its own key there. A key this machine paired with is its own: revoke it and
      // delete the secret pairing made, here. Imported here, as the catalog service is below.
      if (before) void import('../../agent-connect.ts').then((m) => m.dropPairedKey(before)).catch(() => {});
      return true;
    }
    const { yaml } = (change.data ?? {}) as { yaml?: unknown };
    if (typeof yaml !== 'string' || yaml.length > MAX_TEXT) return false;
    if (!claim(change)) return false;
    writeCustomHarness(change.entity_id, yaml);
    return true;
  },
  notify(change) {
    // The catalog lists the files as they are now; probe the one that changed, so its row says whether it is ready.
    // Imported here: the catalog service reaches sync/worker.ts, which loads this handler.
    void import('../../harness/catalog-service.ts').then((m) => m.checkCustomHarness(`custom:${change.entity_id}`)).catch(() => {});
  },
});
