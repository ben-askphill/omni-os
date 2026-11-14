import { ASK_PREFIX } from '@omni/shared/update-fleet.ts';
import { db, kv } from '../db.ts';
import { resolved } from '../user-config.ts';
import { keyring } from './keyring.ts';
import { OWNER_KEY } from './owner.ts';
import { unsigned, verifyChange, type Verdict } from './signing.ts';
import type { Change, RemoteChange } from './transport.ts';

// Whether a pulled change may apply, by its signature (PRD #667, S9, S3). sync/apply.ts asks before a handler runs.
// - Action entities make a machine do something: run a message (remote_command), take a thread (assignment), update
//   itself (update.ask.*), run the automations (automations.owner), store a secret (secretdrop.*, secretack.*). They
//   apply only with a valid signature from the machine they name, and only from the machine whose part they are.
// - Everything else is logged when unsigned or invalid and still applied, so a Mac on an older build keeps syncing
//   while the others update. The `syncSignatures` setting turns that strict, or relaxes actions to log only.
// - A signer with no key here yet (its device record has not arrived) makes an action wait in sync_deferred.
// Refusals, and changes applied without a valid signature, go in sync_refused for Sync settings.

export type SignatureMode = 'actions' | 'strict' | 'log';

export type Gate = { kind: 'apply'; change: RemoteChange } | { kind: 'refuse'; reason: string; change: RemoteChange } | { kind: 'defer'; reason: string };

const DEVICE = 'devices.';
const SECRET_DROP = 'secretdrop.';
const SECRET_ACK = 'secretack.';

/** True for a change that makes a machine act. */
export function isActionChange(c: Pick<Change, 'entity' | 'entity_id'>): boolean {
  if (c.entity === 'remote_command' || c.entity === 'assignment') return true;
  if (c.entity !== 'kv') return false;
  const k = c.entity_id;
  return k === OWNER_KEY || k.startsWith(ASK_PREFIX) || k.startsWith(SECRET_DROP) || k.startsWith(SECRET_ACK);
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const valueOf = (c: Change) => (c.data as { value?: unknown } | null)?.value as Record<string, unknown> | null | undefined;

/** Why the signer may not write this change even with a good signature, or null when it may. */
function roleProblem(c: Change): string | null {
  const signer = c.machine_id;
  if (c.op === 'delete') return deleteProblem(c);
  if (c.entity === 'remote_command') {
    const d = (c.data ?? {}) as Record<string, unknown>;
    return signer === d.sender || signer === d.target ? null : 'signed by a machine that neither sent nor received the command';
  }
  if (c.entity !== 'kv') return null;
  const k = c.entity_id;
  if (k.startsWith(SECRET_DROP) || k.startsWith(ASK_PREFIX)) return str(valueOf(c)?.sender) === signer ? null : 'signed by a machine that is not its sender';
  if (k.startsWith(SECRET_ACK)) {
    const target = str(kv.get<{ target?: unknown }>(SECRET_DROP + k.slice(SECRET_ACK.length))?.target);
    return target && target !== signer ? 'answered by a machine the secret was not for' : null;
  }
  return null;
}

/**
 * A delete of an action entity: only a machine that had a part in it. An assignment is never deleted, and the
 * automations owner and update asks have no delete. Nothing here to compare with leaves it to the handler.
 */
function deleteProblem(c: Change): string | null {
  const signer = c.machine_id;
  const no = 'deleted by a machine that had no part in it';
  if (c.entity === 'remote_command') {
    const row = db.prepare('SELECT sender, target FROM remote_commands WHERE id = ?').get(c.entity_id) as { sender: string; target: string } | undefined;
    return !row || row.sender === signer || row.target === signer ? null : no;
  }
  if (c.entity === 'assignment') return 'assignments are never deleted';
  if (c.entity !== 'kv') return null;
  const k = c.entity_id;
  if (k.startsWith(SECRET_DROP)) {
    const d = kv.get<{ sender?: unknown; target?: unknown }>(k);
    return !d || d.sender === signer || d.target === signer ? null : no;
  }
  if (k === OWNER_KEY || k.startsWith(ASK_PREFIX)) return 'nothing deletes it';
  return null;
}

/** The signing key pinned for a machine, or null before one is. */
const signKeyOf = (machine: string): string | null => keyring.get(machine)?.signKey ?? null;

const REASONS: Record<Exclude<Verdict, 'valid'>, string> = {
  unsigned: 'unsigned',
  'unknown-signer': 'signed by a machine whose key is not here',
  'bad-signature': 'signature does not match the pinned key',
  'signer-mismatch': 'signed by another machine than the one it names',
};

export function gateChange(raw: RemoteChange, mode: SignatureMode = resolved.syncSignatures()): Gate {
  // A machine describes only itself.
  const described = raw.entity === 'kv' && raw.entity_id.startsWith(DEVICE) ? raw.entity_id.slice(DEVICE.length) : null;
  if (described !== null && described !== raw.machine_id) return { kind: 'refuse', reason: "another machine's record", change: unsigned(raw).change };
  // Trust on first sight: a machine with no signing key here yet is pinned with the key its first signed change
  // carries, when that change verifies with it. Its device record may come later than the changes it signs (an
  // automations owner claim goes out in its first sync).
  const carried = unsigned(raw).signature;
  if (carried && carried.signer === raw.machine_id && !signKeyOf(raw.machine_id) && verifyChange(raw, () => carried.key).verdict === 'valid') {
    keyring.observe(raw.machine_id, { signKey: carried.key });
  }
  const { verdict, change } = verifyChange(raw, signKeyOf);
  // The keys a record announces: pinned only from a record that verifies, else kept as seen for Ben to confirm.
  if (described && change.op === 'upsert') {
    const v = valueOf(change);
    keyring.observe(described, { signKey: str(v?.signKey), sealKey: str(v?.sealKey) }, { pin: verdict === 'valid' });
  }
  const action = isActionChange(change);
  if (verdict === 'valid') {
    const role = action ? roleProblem(change) : null;
    return role ? { kind: 'refuse', reason: role, change } : { kind: 'apply', change };
  }
  const reason = REASONS[verdict];
  const strict = action || mode === 'strict';
  if (!strict || (action && mode === 'log' && verdict === 'unsigned')) {
    logRefused(change, reason, true);
    return { kind: 'apply', change };
  }
  if (verdict === 'unknown-signer') return { kind: 'defer', reason: `${reason} yet (${change.machine_id})` };
  return { kind: 'refuse', reason, change };
}

// ---------- the log ----------

const KEEP = 500;

/** Note a change that was refused, or applied without a valid signature. Applied ones fold into one row per machine, entity and reason. */
export function logRefused(c: Pick<Change, 'machine_id' | 'entity' | 'entity_id'>, reason: string, applied: boolean, now = new Date().toISOString()) {
  const key = [c.machine_id, c.entity, applied ? '*' : c.entity_id, reason, applied ? 1 : 0].join('\u0000');
  db.prepare(
    `INSERT INTO sync_refused (key, machine, entity, entity_id, reason, applied, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1, entity_id = excluded.entity_id, at = excluded.at`,
  ).run(key, c.machine_id, c.entity, c.entity_id, reason, applied ? 1 : 0, now);
  db.prepare(`DELETE FROM sync_refused WHERE id NOT IN (SELECT id FROM sync_refused ORDER BY at DESC, id DESC LIMIT ${KEEP})`).run();
}

/** GET /api/sync/refused: one entry per refusal, newest first. */
export interface RefusedChange {
  id: number;
  at: string;
  machine: string;
  entity: string;
  entityId: string;
  reason: string;
  /** Applied anyway: the entity still takes changes without a valid signature (the `syncSignatures` setting). */
  applied: boolean;
  /** How many times this happened; the time is the last. */
  count: number;
}

export function refusedChanges(limit = 50): RefusedChange[] {
  const n = Math.min(Math.max(1, Math.floor(limit) || 50), KEEP);
  const rows = db.prepare('SELECT id, at, machine, entity, entity_id, reason, applied, count FROM sync_refused ORDER BY at DESC, id DESC LIMIT ?').all(n) as {
    id: number;
    at: string;
    machine: string;
    entity: string;
    entity_id: string;
    reason: string;
    applied: number;
    count: number;
  }[];
  return rows.map((r) => ({ id: r.id, at: r.at, machine: r.machine, entity: r.entity, entityId: r.entity_id, reason: r.reason, applied: !!r.applied, count: r.count }));
}
