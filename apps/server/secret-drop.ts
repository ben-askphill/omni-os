// Setting a secret on another synced machine (the Conductor's set_secret, POST /api/secrets/send). Values never sync
// (secret-store.ts), and the relay carries everything between machines, so a value for another machine goes sealed
// to that machine's own key: each machine keeps an X25519 key pair, the private half in its secret store
// (OMNI_SEAL_KEY, never handed to a thread) and the public half in its synced device record (sync/devices.ts). The
// relay and every other machine see only ciphertext.
//
// Two synced kv records per send, each written by one machine only, so last-writer-wins never loses an answer:
// - `secretdrop.<id>`, by the sender: who it is for, the scope and name, and the sealed value. The sender clears the
//   sealed value once the target answers.
// - `secretack.<id>`, by the target: accepted, or rejected with why. After each sync the target opens every drop for
//   it that has no answer yet and saves the value in its own store, so a second sync or a crash ends the same way.
// An unanswered drop is expired after DROP_WINDOW_MS: the target refuses it then, and the sender reports it so.
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { kv, outbox } from './db.ts';
import { globalSecret, secretReachesThread, setSecret, NAME_RE, SCOPE_RE, SEAL_SECRET_NAME } from './secrets.ts';
import { currentRecords, deviceRecord, deviceRecords } from './sync/devices.ts';
import { syncProblem, type SyncNeed } from './sync/problem.ts';
import { activeWorker, onSynced } from './sync/worker.ts';

const DROP = 'secretdrop.';
const ACK = 'secretack.';
/** How long the target has to take a sealed secret. Long enough for a laptop that is asleep overnight. */
export const DROP_WINDOW_MS = 24 * 60 * 60_000;
const INFO = Buffer.from('omni secret drop v1');
export const SECRET_DROP_NEEDS: SyncNeed = { needs: 'Setting a secret on another machine', to: 'set secrets on another machine' };

export interface Sealed {
  /** The sender's one-time X25519 public key, the GCM nonce, ciphertext and tag, base64url. */
  epk: string;
  iv: string;
  ct: string;
  tag: string;
}

export interface SecretDrop {
  id: string;
  sender: string;
  target: string;
  target_name: string;
  scope: string;
  name: string;
  /** Null once the target answered: nothing left for anyone to open. */
  sealed: Sealed | null;
  at: string;
  expires_at: string;
}

export interface SecretAck {
  state: 'accepted' | 'rejected';
  reason: string | null;
  at: string;
}

export type DropState = 'sent' | 'accepted' | 'rejected' | 'expired';

/** A send as the clients and the Conductor see it. Never the value. */
export interface DropView {
  id: string;
  machine: { id: string; name: string };
  scope: string;
  name: string;
  state: DropState;
  reason: string | null;
  at: string;
  expires_at: string;
}

const refused = (message: string, status = 409) => Object.assign(new Error(message), { status });
const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/** What binds a ciphertext to its drop: opening it under another id, machine, scope or name fails. */
const aad = (d: Pick<SecretDrop, 'id' | 'sender' | 'target' | 'scope' | 'name'>) => Buffer.from(JSON.stringify([d.id, d.sender, d.target, d.scope, d.name]));

const keyFor = (shared: Buffer, epk: Buffer) => Buffer.from(hkdfSync('sha256', shared, epk, INFO, 32));

const rawPublic = (k: KeyObject) => unb64(k.export({ format: 'jwk' }).x!);
const publicFromRaw = (raw: string) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw }, format: 'jwk' });

/** Seal a value to a machine's public key (base64url raw X25519). */
export function seal(value: string, to: string, d: Parameters<typeof aad>[0]): Sealed {
  const eph = generateKeyPairSync('x25519');
  const epk = rawPublic(eph.publicKey);
  const key = keyFor(diffieHellman({ privateKey: eph.privateKey, publicKey: publicFromRaw(to) }), epk);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(d));
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { epk: b64(epk), iv: b64(iv), ct: b64(ct), tag: b64(cipher.getAuthTag()) };
}

/** Open a sealed value with this machine's private key. Throws when it was sealed to another key or changed. */
export function open(s: Sealed, privateKey: KeyObject, d: Parameters<typeof aad>[0]): string {
  const epk = unb64(s.epk);
  const key = keyFor(diffieHellman({ privateKey, publicKey: publicFromRaw(s.epk) }), epk);
  const decipher = createDecipheriv('aes-256-gcm', key, unb64(s.iv));
  decipher.setAAD(aad(d));
  decipher.setAuthTag(unb64(s.tag));
  return Buffer.concat([decipher.update(unb64(s.ct)), decipher.final()]).toString('utf8');
}

let ownKey: Promise<KeyObject> | null = null;

/** This machine's private key, made and saved the first time it is asked for. */
function privateKey(): Promise<KeyObject> {
  ownKey ??= (async () => {
    const saved = await globalSecret(SEAL_SECRET_NAME);
    if (saved) return createPrivateKey({ key: unb64(saved), format: 'der', type: 'pkcs8' });
    const { privateKey: k } = generateKeyPairSync('x25519');
    await setSecret('global', SEAL_SECRET_NAME, b64(k.export({ format: 'der', type: 'pkcs8' })));
    return k;
  })().catch((err) => {
    ownKey = null;
    throw err;
  });
  return ownKey;
}

/** This machine's public key for its device record, base64url raw X25519. */
export async function sealPublicKey(): Promise<string> {
  return b64(rawPublic(createPublicKey(await privateKey())));
}

/**
 * Names a program reads before any of its own code runs, to decide what to load, what to run or whom to trust: the
 * dynamic loader's LD_* (Linux) and DYLD_* (macOS), PATH, interpreter options such as NODE_OPTIONS, git's and npm's
 * own settings, the shell's startup files, TLS trust and proxies, and where the harness CLIs send their requests and
 * read their config. A secret reaches every thread's environment, so one of these set by an agent would run its code,
 * or hand it the login, in every later thread. Matched as the environment spells them: exact names, plus prefixes
 * only for namespaces the program owns whole, so PATHS, MY_PATH, LDAP_URL or NODE_AUTH_TOKEN are ordinary secrets.
 * A list like this cannot be complete. It covers the known ways in, not every variable some program reads.
 */
const STARTUP_PREFIXES = ['LD_', 'DYLD_', 'GIT_', 'NPM_CONFIG_'];
const STARTUP_NAMES = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PERL5OPT',
  'PERL5LIB',
  'PERL5DB',
  'PERLLIB',
  'RUBYOPT',
  'RUBYLIB',
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'HOME',
  'SHELL',
  'ENV',
  'BASH_ENV',
  'ZDOTDIR',
  'IFS',
  'GCONV_PATH',
  'TMPDIR',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'ANTHROPIC_BASE_URL',
  'OPENAI_BASE_URL',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'LESSOPEN',
  'LESSCLOSE',
  'PROMPT_COMMAND',
]);

/** Whether a secret by this name would change how every thread's programs start. Settings can set one; set_secret cannot. */
export const changesHowProgramsStart = (name: string): boolean => STARTUP_NAMES.has(name) || STARTUP_PREFIXES.some((p) => name.startsWith(p));

/**
 * Refuses a scope or name setSecret would, Omni's own credentials and names that change how programs start, which only
 * Settings sets. Both set_secret paths call it, and so does the receiving machine before it opens a drop.
 */
export function checkSecret(scope: string, name: string, value: string) {
  if (!SCOPE_RE.test(scope)) throw refused('scope is global or channel:<channel id>', 400);
  if (!NAME_RE.test(name)) throw refused('name must be UPPER_SNAKE_CASE', 400);
  if (!value || /[\r\n]/.test(value)) throw refused('value must be a single non-empty line', 400);
  if (!secretReachesThread(scope, name)) throw refused(`${name} is one of Omni's own credentials. Set it in Settings on that machine.`, 403);
  if (changesHowProgramsStart(name)) throw refused(`${name} changes how every thread's programs start, so only Settings can set it.`, 403);
}

/** A synced machine by id or by name (any case). Refuses one this machine does not know, or a name two share. */
export function machineFor(asked: string): { id: string; name: string } {
  const all = currentRecords(deviceRecords());
  const byId = all.find((d) => d.id === asked);
  if (byId) return { id: byId.id, name: byId.name };
  const named = all.filter((d) => d.name.toLowerCase() === asked.trim().toLowerCase());
  if (named.length === 1) return { id: named[0].id, name: named[0].name };
  const known = all.map((d) => `${d.name} (${d.id})`).join(', ') || 'none yet';
  if (named.length > 1) throw refused(`More than one synced machine is called ${asked}. Pass its id: ${known}.`, 400);
  throw refused(`No synced machine is called ${asked}. Synced machines: ${known}.`, 404);
}

/**
 * Seal a secret to another synced machine and queue it for the next sync. The target saves it in its own store after
 * it syncs, and answers; secretDrops shows the answer.
 */
export function sendSecret(machine: string, scope: string, name: string, value: string): DropView {
  checkSecret(scope, name, value);
  const self = outbox.machineId();
  if (!self || !activeWorker()) throw refused(syncProblem(SECRET_DROP_NEEDS));
  const target = machineFor(machine);
  if (target.id === self) throw refused('That is this machine. Leave machine out to set it here.', 400);
  const key = deviceRecord(target.id)?.sealKey;
  if (!key) throw refused(`${target.name} has not published a key for secrets yet. Update Omni there and let it sync once.`);
  const id = randomUUID();
  const now = Date.now();
  const meta = { id, sender: self, target: target.id, scope, name };
  const drop: SecretDrop = {
    ...meta,
    target_name: target.name,
    sealed: seal(value, key, meta),
    at: new Date(now).toISOString(),
    expires_at: new Date(now + DROP_WINDOW_MS).toISOString(),
  };
  kv.set(DROP + id, drop);
  void activeWorker()?.syncNow();
  return viewOf(drop, null);
}

const isDrop = (v: unknown): v is SecretDrop => {
  const d = v as Partial<SecretDrop> | null;
  return !!d && typeof d.id === 'string' && typeof d.sender === 'string' && typeof d.target === 'string' && typeof d.scope === 'string' && typeof d.name === 'string' && typeof d.expires_at === 'string';
};
const isAck = (v: unknown): v is SecretAck => {
  const a = v as Partial<SecretAck> | null;
  return !!a && (a.state === 'accepted' || a.state === 'rejected');
};
const ackOf = (id: string) => {
  const a = kv.get<unknown>(ACK + id);
  return isAck(a) ? a : null;
};

function viewOf(d: SecretDrop, ack: SecretAck | null, now = Date.now()): DropView {
  const state: DropState = ack ? ack.state : Date.parse(d.expires_at) <= now ? 'expired' : 'sent';
  const reason = ack?.reason ?? (state === 'expired' ? `${d.target_name} did not take it within 24 hours.` : null);
  return { id: d.id, machine: { id: d.target, name: d.target_name }, scope: d.scope, name: d.name, state, reason, at: d.at, expires_at: d.expires_at };
}

/** The secrets this machine sent elsewhere, newest first, with each one's answer. Never a value. */
export function secretDrops(limit = 50): DropView[] {
  const self = outbox.machineId();
  return kv
    .list<unknown>(DROP)
    .flatMap(([, v]) => (isDrop(v) && v.sender === self ? [viewOf(v, ackOf(v.id))] : []))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** One sent secret by id, or null. */
export function secretDrop(id: string): DropView | null {
  const d = kv.get<unknown>(DROP + id);
  return isDrop(d) ? viewOf(d, ackOf(d.id)) : null;
}

/** The target's answer to a drop, given once: a later pass never replaces it, so a refusal cannot undo an accepted secret. */
function answer(id: string, state: SecretAck['state'], reason: string | null = null) {
  if (ackOf(id)) return;
  kv.set(ACK + id, { state, reason, at: new Date().toISOString() } satisfies SecretAck);
}

let reconciling: Promise<void> | null = null;
let again = false;

/**
 * After a sync: open and save every secret sent to this machine that has no answer yet, and clear the sealed value of
 * every one this machine sent that has been answered. Safe to run any number of times. One pass at a time, so two
 * passes never write the same secret into the store at once (the Keychain refuses one of them): a call during a pass
 * runs one more pass after it, however many calls came, so a drop that synced meanwhile is still taken. A pass that
 * throws frees the lock, and a pass queued behind it still runs. `now` is for tests.
 */
export function reconcileSecretDrops(now?: number): Promise<void> {
  if (reconciling) {
    again = true;
    return reconciling;
  }
  reconciling = (async () => {
    try {
      do {
        again = false;
        try {
          await reconcileOnce(now ?? Date.now());
        } catch (err) {
          if (!again) throw err;
          console.error('[secrets] could not take a sent secret, trying again:', (err as Error).message);
        }
      } while (again);
    } finally {
      reconciling = null;
    }
  })();
  return reconciling;
}

async function reconcileOnce(now: number): Promise<void> {
  const self = outbox.machineId();
  if (!self) return;
  for (const [key, v] of kv.list<unknown>(DROP)) {
    if (!isDrop(v)) continue;
    const ack = ackOf(v.id);
    if (v.sender === self && ack && v.sealed) kv.set(key, { ...v, sealed: null } satisfies SecretDrop);
    if (v.target !== self || ack) continue;
    if (Date.parse(v.expires_at) <= now) {
      answer(v.id, 'rejected', 'It came after its 24 hours were up. Send it again.');
      continue;
    }
    if (!v.sealed) continue;
    // A store that cannot be read now (a locked Keychain) is tried again after the next sync, not refused.
    const own = await privateKey();
    let value: string;
    try {
      checkSecret(v.scope, v.name, 'x');
      value = open(v.sealed, own, v);
      checkSecret(v.scope, v.name, value);
    } catch (err) {
      const why = (err as { status?: number }).status ? (err as Error).message : 'It was sealed to another key for this machine. Send it again.';
      answer(v.id, 'rejected', why);
      continue;
    }
    try {
      await setSecret(v.scope, v.name, value);
    } catch (err) {
      answer(v.id, 'rejected', `The secret store refused it: ${(err as Error).message}`);
      continue;
    }
    // Outside the try: failing to record the answer is not the store refusing it. The pass throws, and the next one
    // saves the value again and answers.
    answer(v.id, 'accepted');
  }
}

onSynced(() => void reconcileSecretDrops().catch((err) => console.error('[secrets] could not take a sent secret:', (err as Error).message)));
