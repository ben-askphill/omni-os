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
  if (c.op === 'delete') return null;
  const signer = c.machine_id;
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

/** The pinned signing key, pinning the one its device record (sync/devices.ts) carries the first time the machine is seen. */
function signKeyOf(machine: string): string | null {
  const pinned = keyring.get(machine)?.signKey;
  if (pinned) return pinned;
  const rec = kv.get<{ signKey?: unknown; sealKey?: unknown }>(DEVICE + machine);
  if (!str(rec?.signKey)) return null;
  keyring.observe(machine, { signKey: str(rec?.signKey), sealKey: str(rec?.sealKey) });
  return keyring.get(machine)?.signKey ?? null;
}

const REASONS: Record<Exclude<Verdict, 'valid'>, string> = {
  unsigned: 'unsigned',
  'unknown-signer': 'signed by a machine whose key is not here',
  'bad-signature': 'signature does not match the pinned key',
  'signer-mismatch': 'signed by another machine than the one it names',
};

export function gateChange(raw: RemoteChange, mode: SignatureMode = resolved.syncSignatures()): Gate {
  // A machine describes only itself. Its record is where its keys come from, so they are noted before the check.
  // The first record seen for a machine pins its keys; a later one with other keys is kept as seen (sync/keyring.ts).
  const described = raw.entity === 'kv' && raw.entity_id.startsWith(DEVICE) ? raw.entity_id.slice(DEVICE.length) : null;
  if (described !== null && described !== raw.machine_id) return { kind: 'refuse', reason: "another machine's record", change: unsigned(raw).change };
  if (described && raw.op === 'upsert') {
    const v = valueOf(raw);
    keyring.observe(described, { signKey: str(v?.signKey), sealKey: str(v?.sealKey) });
  }
  // A machine seen for the first time is pinned with the key its first signed change carries: its device record may
  // come later than the changes it signs (an automations owner claim goes out in its first sync).
  const carried = unsigned(raw).signature;
  if (carried && carried.signer === raw.machine_id && !signKeyOf(raw.machine_id)) keyring.observe(raw.machine_id, { signKey: carried.key });
  const { verdict, change } = verifyChange(raw, signKeyOf);
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
