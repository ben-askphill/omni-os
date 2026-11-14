// Signed sync changes (PRD #667, S9, S20, S3). Every change a machine pushes carries an Ed25519 signature by that
// machine's own key, so the relay (or anyone holding a relay token) cannot invent a change in a machine's name. Pure:
// keys come in as arguments, and which key belongs to which machine is the keyring's business (sync/keyring.ts).
//
// The signature rides inside the change's data as `_omni_sig`, since the relay keeps only the change's own fields and
// stores data opaquely (ADR 0008). A delete, whose data is null, carries `{ _omni_sig }`. An older build ignores the
// field: every handler reads the columns it knows.
//
// What is signed: the machine id, entity, entity id, op, the time and a SHA-256 of the data without the signature, in
// canonical JSON (keys sorted), so the same change verifies however a JSON round trip ordered its keys. A signature
// copied onto another change, another machine's change or another time fails.
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { Change } from './transport.ts';

export const SIG_FIELD = '_omni_sig';
const DOMAIN = 'omni-sync-v1';

export interface ChangeSignature {
  v: 1;
  /** The machine whose key signed it. Must be the change's machine_id. */
  signer: string;
  /**
   * The signer's public key, base64url raw Ed25519. It only says which key to pin the first time a machine is seen
   * (sync/keyring.ts): after that the pinned key decides, whatever a change carries.
   */
  key: string;
  /** Ed25519 signature, base64url. */
  sig: string;
}

/** valid: signed by the machine it names, with the key pinned for it. The rest say why not. */
export type Verdict = 'valid' | 'unsigned' | 'unknown-signer' | 'bad-signature' | 'signer-mismatch';

/** JSON with object keys sorted at every level. undefined members are left out, as JSON.stringify does. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/** The relay stores a time as Date#toISOString, so both ends sign that form. */
const isoOf = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString();
};

/** The change without its signature: the data a handler sees. A delete's `{ _omni_sig }` becomes null again. */
export function unsigned<C extends Change>(change: C): { change: C; signature: ChangeSignature | null } {
  const d = change.data;
  if (!d || typeof d !== 'object' || Array.isArray(d) || !(SIG_FIELD in d)) return { change, signature: null };
  const { [SIG_FIELD]: raw, ...rest } = d as Record<string, unknown>;
  const s = raw as Partial<ChangeSignature> | null;
  const signature = s && s.v === 1 && typeof s.signer === 'string' && typeof s.sig === 'string' && typeof s.key === 'string' ? (s as ChangeSignature) : null;
  const data = change.op === 'delete' && !Object.keys(rest).length ? null : rest;
  return { change: { ...change, data }, signature };
}

function message(c: Change): Buffer {
  const hash = createHash('sha256').update(canonical(c.data ?? null)).digest('hex');
  return Buffer.from([DOMAIN, c.machine_id, c.entity, c.entity_id, c.op, isoOf(c.ts), hash].join('\n'));
}

/** The change with its signature in its data. The machine id is the signer. */
export function signChange<C extends Change>(change: C, key: KeyObject): C {
  const base = unsigned(change).change;
  // Data that is not an object (no handler sends one) cannot carry a signature without changing what it is.
  if (base.data !== null && (typeof base.data !== 'object' || Array.isArray(base.data))) return base;
  const signature: ChangeSignature = { v: 1, signer: base.machine_id, key: rawPublicKey(key), sig: sign(null, message(base), key).toString('base64url') };
  return { ...base, data: { ...((base.data as object | null) ?? {}), [SIG_FIELD]: signature } };
}

/**
 * Whether a change is signed by the machine it names, with the key `keyFor` returns for that machine (base64url raw
 * Ed25519, or null when none is pinned). Returns the change without its signature either way.
 */
export function verifyChange<C extends Change>(change: C, keyFor: (machine: string) => string | null): { verdict: Verdict; change: C; signature: ChangeSignature | null } {
  const { change: plain, signature } = unsigned(change);
  if (!signature) return { verdict: 'unsigned', change: plain, signature };
  if (signature.signer !== plain.machine_id) return { verdict: 'signer-mismatch', change: plain, signature };
  const raw = keyFor(signature.signer);
  if (!raw) return { verdict: 'unknown-signer', change: plain, signature };
  let ok = false;
  try {
    ok = verify(null, message(plain), publicKeyFromRaw(raw), Buffer.from(signature.sig, 'base64url'));
  } catch {
    ok = false;
  }
  return { verdict: ok ? 'valid' : 'bad-signature', change: plain, signature };
}

export const publicKeyFromRaw = (raw: string): KeyObject => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' });

/** A private key's public half, base64url raw Ed25519, for the device record. */
export const rawPublicKey = (key: KeyObject): string => createPublicKey(key).export({ format: 'jwk' }).x!;

export const privateKeyFromDer = (der: string): KeyObject => createPrivateKey({ key: Buffer.from(der, 'base64url'), format: 'der', type: 'pkcs8' });

/** A short, readable form of a public key to compare between machines: the first 16 bytes of its SHA-256, in groups. */
export function fingerprint(raw: string): string {
  const hex = createHash('sha256').update(Buffer.from(raw, 'base64url')).digest('hex').slice(0, 32).toUpperCase();
  return hex.match(/.{4}/g)!.join(' ');
}
