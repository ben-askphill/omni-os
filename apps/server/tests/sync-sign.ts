import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { signChange } from '../sync/signing.ts';
import type { Change } from '../sync/transport.ts';

// Another machine's signing key, for tests that push changes to the relay as that machine. The receiver pins the
// key the first signed change from a machine carries (sync/verify.ts), as it would a real Mac's.

const keys = new Map<string, KeyObject>();

export const keyOf = (machine: string): KeyObject => {
  let k = keys.get(machine);
  if (!k) keys.set(machine, (k = generateKeyPairSync('ed25519').privateKey));
  return k;
};

/** The change, signed by its machine_id's test key. */
export const signAs = <C extends Change>(change: C): C => signChange(change, keyOf(change.machine_id));

/**
 * Macs in one process that trust each other, as Ben's Trust click in Sync settings makes them (sync/keyring.ts). Each
 * gives its own db and the signing key its own copy of the server modules made (`sync/sign-key.ts`).
 */
export function trustEachOther(macs: { name: string; db: { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }; signKey: string }[]) {
  for (const m of macs)
    for (const o of macs)
      if (o !== m) m.db.db.prepare('INSERT OR IGNORE INTO sync_trusted (machine_id, sign_key, trusted_at) VALUES (?, ?, ?)').run(o.name, o.signKey, new Date().toISOString());
}
