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
