// The level a channel with none of its own runs at on this machine (M1, ADR 0015). Set once, at the first boot that
// reads it: an install that already has threads keeps full access, so nothing changes for it; a fresh install starts
// at Ask first. Per machine (a sync.* key, never synced), so a new machine joining sync never changes what the user's
// other machines do. A channel's own level syncs and wins everywhere.
import { isAccessLevel, NEW_INSTALL_ACCESS, type AccessLevel } from '@omni/shared/access.ts';
// The connection and kv directly, not db.ts: db.ts loads the channels repo, which reads this file.
import { db } from './db/connection.ts';
import { kv } from './db/repos/kv.ts';

const KEY = 'sync.access.default';

/** OMNI_ACCESS_DEFAULT pins it, for a QA stack or tests; else what the first boot decided; else full access. */
export function installDefault(): AccessLevel {
  const env = process.env.OMNI_ACCESS_DEFAULT;
  if (isAccessLevel(env)) return env;
  const saved = kv.get<string>(KEY);
  return isAccessLevel(saved) ? saved : 'full';
}

/** At boot, once: decide this machine's default. True when it decided now. */
export function settleInstallDefault(): boolean {
  if (isAccessLevel(kv.get<string>(KEY))) return false;
  const hasHistory = db.prepare('SELECT 1 FROM threads LIMIT 1').get();
  kv.set(KEY, hasHistory ? 'full' : NEW_INSTALL_ACCESS);
  return true;
}
