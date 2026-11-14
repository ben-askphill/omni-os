import { db } from '../db.ts';
import { fingerprint } from './signing.ts';

// The other machines' public keys, as this machine pinned them (PRD #667, S9, S3). Each machine's device record
// (sync/devices.ts) announces a signing key (Ed25519) and a seal key (X25519, secret-drop.ts). The first key this
// machine sees for a machine is pinned. A different key seen later never replaces the pinned one by itself: it is kept
// as seen_*, changes from that machine stop verifying, secrets stop sealing to it, and Sync settings shows the change
// until Ben confirms the new key (a re-paired or reinstalled Mac).
//
// Trust on first sight for keys: a machine id this machine has never seen is pinned with whatever key its first record
// carries. Its ordinary changes sync at once, but it may not make this machine act (sync/verify.ts) until Ben trusts it
// in Sync settings, where the device list shows its fingerprint. One button confirms a new machine and a changed key.

export type KeyKind = 'sign' | 'seal';

export interface PinnedKeys {
  machine: string;
  signKey: string | null;
  sealKey: string | null;
  pinnedAt: string;
  /** A key the machine's record carries now that differs from the pinned one, waiting for Ben to confirm it. */
  seenSignKey: string | null;
  seenSealKey: string | null;
  seenAt: string | null;
}

interface Row {
  machine_id: string;
  sign_key: string | null;
  seal_key: string | null;
  pinned_at: string;
  seen_sign_key: string | null;
  seen_seal_key: string | null;
  seen_at: string | null;
}

const toPinned = (r: Row): PinnedKeys => ({
  machine: r.machine_id,
  signKey: r.sign_key,
  sealKey: r.seal_key,
  pinnedAt: r.pinned_at,
  seenSignKey: r.seen_sign_key,
  seenSealKey: r.seen_seal_key,
  seenAt: r.seen_at,
});

const rowOf = (machine: string) => db.prepare('SELECT * FROM sync_keys WHERE machine_id = ?').get(machine) as Row | undefined;

export const keyring = {
  get(machine: string): PinnedKeys | null {
    const r = rowOf(machine);
    return r ? toPinned(r) : null;
  },

  list(): PinnedKeys[] {
    return (db.prepare('SELECT * FROM sync_keys ORDER BY machine_id').all() as unknown as Row[]).map(toPinned);
  },

  /**
   * What a machine's record says its keys are now. With `pin`, a key with nothing pinned yet is pinned; without it
   * (the key came on a change that did not verify), it is only seen. One that differs from the pinned key is kept as
   * seen, and one that matches again clears it. Returns whether a seen key waits for confirmation.
   */
  observe(
    machine: string,
    keys: { signKey?: string | null; sealKey?: string | null },
    { pin = true, now = new Date().toISOString() }: { pin?: boolean; now?: string } = {},
  ): boolean {
    const sign = keys.signKey || null;
    const seal = keys.sealKey || null;
    if (!sign && !seal) return false;
    let r = rowOf(machine);
    if (!r) {
      db.prepare('INSERT INTO sync_keys (machine_id, sign_key, seal_key, pinned_at) VALUES (?, ?, ?, ?)').run(machine, pin ? sign : null, pin ? seal : null, now);
      if (pin) return false;
      r = rowOf(machine)!;
    }
    // Keys that come from a change that did not verify are only ever seen, never pinned: Ben confirms them.
    const pinSign = r.sign_key ?? (pin ? sign : null);
    const pinSeal = r.seal_key ?? (pin ? seal : null);
    const seenSign = sign && sign !== pinSign ? sign : null;
    const seenSeal = seal && seal !== pinSeal ? seal : null;
    const changed = !!(seenSign || seenSeal);
    const seenAt = changed ? (seenSign === r.seen_sign_key && seenSeal === r.seen_seal_key && r.seen_at ? r.seen_at : now) : null;
    db.prepare(
      'UPDATE sync_keys SET sign_key = ?, seal_key = ?, seen_sign_key = ?, seen_seal_key = ?, seen_at = ? WHERE machine_id = ?',
    ).run(pinSign, pinSeal, seenSign, seenSeal, seenAt, machine);
    return changed;
  },

  /** Pin the keys a machine's record carries now. Ben confirms them in Sync settings. False when nothing waits. */
  confirm(machine: string, now = new Date().toISOString()): boolean {
    const r = rowOf(machine);
    if (!r || (!r.seen_sign_key && !r.seen_seal_key)) return false;
    db.prepare(
      `UPDATE sync_keys SET sign_key = COALESCE(seen_sign_key, sign_key), seal_key = COALESCE(seen_seal_key, seal_key), pinned_at = ?,
       seen_sign_key = NULL, seen_seal_key = NULL, seen_at = NULL WHERE machine_id = ?`,
    ).run(now, machine);
    return true;
  },

  /** Whether Ben trusts a machine to make this one act (its commands, assignments, update asks, owner claims and secrets). */
  trusted(machine: string): boolean {
    return !!db.prepare('SELECT 1 FROM sync_trusted WHERE machine_id = ?').get(machine);
  },

  /** Trust a machine. False when it already was. */
  trust(machine: string, now = new Date().toISOString()): boolean {
    return db.prepare('INSERT OR IGNORE INTO sync_trusted (machine_id, trusted_at) VALUES (?, ?)').run(machine, now).changes > 0;
  },

  /** Forget a machine's pins and trust, for tests and a machine Ben removed. */
  forget(machine: string) {
    db.prepare('DELETE FROM sync_keys WHERE machine_id = ?').run(machine);
    db.prepare('DELETE FROM sync_trusted WHERE machine_id = ?').run(machine);
  },
};

/** A key's fingerprint, or null without one. */
export const fingerprintOf = (raw: string | null | undefined): string | null => (raw ? fingerprint(raw) : null);
