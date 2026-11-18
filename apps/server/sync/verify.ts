import { ASK_PREFIX } from '@omni/shared/update-fleet.ts';
import { db, kv, outbox, remoteCommands, threads, type RemoteCommand } from '../db.ts';
import { COMMAND_KINDS } from '../db/repos/remote-commands.ts';
import { resolved } from '../user-config.ts';
import { deviceRecord } from './device-records.ts';
import { keyring } from './keyring.ts';
import { OWNER_KEY } from './owner.ts';
import { unsigned, verifyChange, type Verdict } from './signing.ts';
import type { Change, RemoteChange } from './transport.ts';

// Whether a pulled change may apply, by its signature (PRD #667, S9, S3). sync/apply.ts asks before a handler runs.
// - Action entities make a machine do something: run a message (remote_command), take a thread (assignment), update
//   itself (update.ask.*), run the automations (automations.owner, automation_file), run a crew role's prompt (crew_file),
//   store a secret (secretdrop.*, secretack.*), let an assistant into /mcp (mcp_client). They apply only with a valid signature from the machine they name, and only
//   from the machine whose part they are.
// - Everything else is logged when unsigned or invalid and still applied, so a Mac on an older build keeps syncing
//   while the others update. The `syncSignatures` setting turns that strict, or relaxes actions to log only.
// - A signer with no key here yet (its device record has not arrived) makes an action wait in sync_deferred.
// - A machine is trusted with the first key pinned for it (sync/keyring.ts), so a paired machine's actions apply at once.
//   A first key is pinned from a change only when the relay lists the machine's Connect registration. Otherwise it is
//   kept as seen: the machine's data syncs by the signature mode and its actions wait for Trust.
//   One that is still not trusted (keyring.trusted) syncs everything else, but its signed actions wait in sync_deferred,
//   listed in sync_refused, until Ben trusts it in Sync settings (POST /api/sync/devices/:id/confirm-key).
// - A machine whose key changed: its actions signed with the new key wait the same way until Ben confirms that key, the
//   same call. Confirming discards held actions, so confirmation never runs actions Ben has not reviewed.
// Refusals, and changes applied without a valid signature, go in sync_refused for Sync settings.

export type SignatureMode = 'actions' | 'strict' | 'log';

/**
 * `unverified`: why the signature did not check out on a change that applies anyway. The caller logs it with the write
 * (sync/apply.ts), so a change that fails and waits in sync_deferred is logged once it lands, not on every retry.
 */
export type Gate =
  | { kind: 'apply'; change: RemoteChange; unverified?: string }
  | { kind: 'refuse'; reason: string; change: RemoteChange }
  | { kind: 'defer'; reason: string };

const DEVICE = 'devices.';
const SECRET_DROP = 'secretdrop.';
const SECRET_ACK = 'secretack.';

/** True for a change that makes a machine act. */
export function isActionChange(c: Pick<Change, 'entity' | 'entity_id'>): boolean {
  // An automation file is a prompt a machine runs on its schedule, on the machine it names. A crew file is a prompt
  // every later thread of that role runs with, with full permissions. An approved MCP client may start threads on every
  // machine.
  if (c.entity === 'remote_command' || c.entity === 'assignment' || c.entity === 'automation_file' || c.entity === 'crew_file' || c.entity === 'mcp_client') {
    return true;
  }
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

const UNTRUSTED = 'waiting for Trust';
const KEY_CHANGED = 'waiting for the new key to be confirmed';

export function gateChange(raw: RemoteChange, mode: SignatureMode = resolved.syncSignatures(), pairedMachines?: ReadonlySet<string>): Gate {
  // A machine describes only itself.
  // The relay never hands a machine its own changes back: one that names this machine is forged.
  if (raw.machine_id === outbox.machineId()) return { kind: 'refuse', reason: 'names this machine', change: unsigned(raw).change };
  const described = raw.entity === 'kv' && raw.entity_id.startsWith(DEVICE) ? raw.entity_id.slice(DEVICE.length) : null;
  if (described !== null && described !== raw.machine_id) return { kind: 'refuse', reason: "another machine's record", change: unsigned(raw).change };
  // Trust on first sight: a machine with no signing key here yet is pinned with the key its first signed change
  // carries, when that change verifies with it. Its device record may come later than the changes it signs (an
  // automations owner claim goes out in its first sync).
  const carried = unsigned(raw).signature;
  if (carried && carried.signer === raw.machine_id && !signKeyOf(raw.machine_id) && verifyChange(raw, () => carried.key).verdict === 'valid') {
    // Without relay registration evidence the key is only seen: Ben trusts it in Sync settings, or a later
    // registration pins it. A pinned key would be trusted by the startup migration. Its signed device record waits
    // too, so the seal key it announces is pinned from that record once its signing key is.
    const paired = !!pairedMachines?.has(raw.machine_id);
    keyring.observe(raw.machine_id, { signKey: carried.key }, { pin: paired });
    if (paired) db.prepare('DELETE FROM sync_refused WHERE machine = ? AND reason = ?').run(raw.machine_id, UNTRUSTED);
    else if (described) return { kind: 'defer', reason: `${UNTRUSTED} (${raw.machine_id})` };
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
    if (role) return { kind: 'refuse', reason: role, change };
    if (action && !keyring.trusted(change.machine_id)) {
      logHeld(change, UNTRUSTED);
      return { kind: 'defer', reason: `${UNTRUSTED} (${change.machine_id})` };
    }
    return { kind: 'apply', change };
  }
  // Signed by the machine with the key it announced but this machine has not pinned (a changed key, or a first key
  // without relay registration): held until Ben confirms, then discarded. Nothing applies before then.
  if (action && (verdict === 'bad-signature' || verdict === 'unknown-signer') && carried?.signer === raw.machine_id && carried.key === keyring.get(raw.machine_id)?.seenSignKey) {
    if (verifyChange(raw, () => carried.key).verdict === 'valid') {
      const reason = signKeyOf(raw.machine_id) ? KEY_CHANGED : UNTRUSTED;
      logHeld(change, reason);
      return { kind: 'defer', reason: `${reason} (${change.machine_id})` };
    }
  }
  const reason = REASONS[verdict];
  const strict = action || mode === 'strict';
  if (!strict || (action && mode === 'log' && verdict === 'unsigned')) return { kind: 'apply', change, unverified: reason };
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

/** Note an action held for Trust or a key confirmation, once: each sync retries it, and that is not news. */
function logHeld(c: Pick<Change, 'machine_id' | 'entity' | 'entity_id'>, reason: string, now = new Date().toISOString()) {
  const key = [c.machine_id, c.entity, c.entity_id, reason, 0].join('\u0000');
  db.prepare(
    `INSERT INTO sync_refused (key, machine, entity, entity_id, reason, applied, at) VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(key) DO NOTHING`,
  ).run(key, c.machine_id, c.entity, c.entity_id, reason, now);
}

/**
 * Confirming a key never authorizes unseen actions. Called in the confirmation transaction, after the key is pinned and
 * before sync resumes. A command for this machine that verifies with that key is answered as rejected, so its sender
 * says it was not delivered instead of waiting a day.
 */
export function discardHeld(machine: string) {
  const rows = db.prepare('SELECT seq, change FROM sync_deferred').all() as { seq: number; change: string }[];
  db.prepare('DELETE FROM sync_refused WHERE machine = ? AND reason IN (?, ?)').run(machine, UNTRUSTED, KEY_CHANGED);
  for (const row of rows) {
    const change = JSON.parse(row.change) as RemoteChange;
    // Include actions waiting on dependencies or an unknown handler, not just those logged as waiting for a key.
    if (change.machine_id !== machine || !isActionChange(change)) continue;
    logRefused(change, 'discarded when the key was confirmed; send again if still needed', false);
    db.prepare('DELETE FROM sync_deferred WHERE seq = ?').run(row.seq);
    answerDropped(change);
  }
}

const KINDS: readonly unknown[] = COMMAND_KINDS;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);

/**
 * A dropped command its signer sent to this machine, for a thread here: saved as rejected and synced back, never run.
 * Only one signed with the key Ben just confirmed: the queue also holds changes that never verified (one deferred
 * before the machine had a key), and answering those would push forged ids, signed by this machine, that the sender
 * may use later. Its ids only: the sender has its own copy of what it said, and the answer carries none of it.
 */
function answerDropped(raw: RemoteChange) {
  const self = outbox.machineId();
  const { verdict, change: c } = verifyChange(raw, signKeyOf);
  if (verdict !== 'valid' || !self) return;
  const d = (c.data ?? {}) as Partial<RemoteCommand>;
  if (c.entity !== 'remote_command' || c.op !== 'upsert' || d.target !== self || d.sender !== c.machine_id || d.state !== 'sent') return;
  if (!isId(c.entity_id) || !KINDS.includes(d.kind) || !isId(d.thread_id) || !threads.get(d.thread_id) || typeof d.expires_at !== 'string') return;
  const here = typeof d.target_name === 'string' && d.target_name ? d.target_name : (deviceRecord(self)?.name ?? self);
  const sender = deviceRecord(c.machine_id)?.name ?? c.machine_id;
  remoteCommands.saveRejected(
    {
      id: c.entity_id,
      thread_id: d.thread_id,
      kind: d.kind!,
      sender: c.machine_id,
      target: self,
      target_name: here,
      expires_at: d.expires_at,
      created_at: typeof d.created_at === 'string' ? d.created_at : c.ts,
    },
    self,
    `${here} dropped it unread when you confirmed ${sender}'s key there. Send it again.`,
  );
}

/** The machines whose actions this one holds, and how many, for the Inbox and Sync settings. */
export function heldActions(): { machine: string; reason: 'untrusted' | 'key-changed'; count: number; since: string }[] {
  const rows = db
    .prepare('SELECT machine, reason, COUNT(*) AS count, MIN(at) AS since FROM sync_refused WHERE applied = 0 AND reason IN (?, ?) GROUP BY machine, reason ORDER BY since')
    .all(UNTRUSTED, KEY_CHANGED) as { machine: string; reason: string; count: number; since: string }[];
  return rows.map((r) => ({ machine: r.machine, reason: r.reason === UNTRUSTED ? 'untrusted' : 'key-changed', count: r.count, since: r.since }));
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
