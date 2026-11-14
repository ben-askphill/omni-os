// Which account each harness on this machine is signed in to, read without touching a credential, and the same for
// every synced machine as each last reported it (@omni/shared/harness-accounts.ts has the shape and the words).
//
// How each harness says who it runs as, all read-only and run with the environment the harness itself gets
// (env-guard.ts), so the answer is the account a thread here would bill:
// - Claude Code: `claude auth status --json`: email, organization, subscription type.
// - Codex: `codex app-server`'s account/read, as the catalog probe asks it: email, plan, workspace. An API key login
//   is not the ChatGPT plan Omni runs on, so it reads as signed out.
// - Cursor Agent: `cursor-agent about --format json`: email and subscription tier.
// - Cursor Cloud: GET /v1/me with the global CURSOR_API_KEY: the email the key belongs to, and the key's name.
// - Hermes: nothing to read. It bills an Anthropic key on its own server, so the row names that server only.
// Only the fields harness/accounts-parse.ts picks leave a reader, and every string goes through its `clean`, which
// drops anything shaped like a token: a CLI that one day prints one never gets it into a response, a log or the synced record. A failed
// check keeps its output to itself too: the row says "Could not check", never what the CLI printed.
//
// This machine's record goes to the synced kv `accounts.<machine id>` when it changed, and at most every few hours
// otherwise, since the relay keeps every write. Each machine writes only its own key. A switch (a reading signed in as
// someone else than the last signed-in account) stays on the record with the account before it until the next one;
// `accounts-seen.<machine>.<harness>` holds the account it was acknowledged as, written from any machine.
import { execFile } from 'node:child_process';
import {
  ACCOUNTS_PREFIX,
  identityKey,
  nextAccount,
  RAN_PREFIX,
  seenKey,
  switchNotice,
  type AccountsView,
  type HarnessAccount,
  type MachineAccounts,
  type MachineAccountsRecord,
  type ThreadAccount,
} from '@omni/shared/harness-accounts.ts';
import { publishFeed } from './bus.ts';
import { config } from './config.ts';
import { kv, outbox } from './db.ts';
import { CodexClient } from './harness/codex/client.ts';
import { codexBin } from './harness/codex/bin.ts';
import type { GetAccountResponse } from './harness/codex/protocol.ts';
import { cursorBin } from './harness/cursor/bin.ts';
import { CursorCloudClient } from './harness/cursor-cloud/client.ts';
import { probeHermes } from './harness/hermes/client.ts';
import { account, clean, parseClaudeStatus, parseCodexAccount, parseCursorAbout, parseCursorMe, sanitize } from './harness/accounts-parse.ts';
import { harnessEnv } from './harness/env-guard.ts';
import { HARNESS_IDS, type HarnessId } from './harness/types.ts';
import { globalSecret } from './secrets.ts';
import { computerName, currentRecords, deviceRecords } from './sync/devices.ts';
import { activeWorker, onSynced } from './sync/worker.ts';

/** A reading this young answers GET /api/accounts as it is. */
const FRESH_MS = 60_000;
/** After a sync, read again once the last reading is this old, so the other machines see a switch soon after it. */
const SYNC_EVERY_MS = 10 * 60_000;
/** An unchanged record is written again this long after the last write, so the others see it is current. */
const REWRITE_MS = 6 * 60 * 60_000;
/** How long one harness's check may take. */
const CHECK_MS = 8_000;
/** This machine's id before sync gives it one. */
const LOCAL_ID = 'local';
/** Where this machine's record lives before sync gives it an id: a sync.* key, so it never leaves this machine. */
const LOCAL_KEY = 'sync.accounts.local';

const options: { env?: NodeJS.ProcessEnv; read?: (harness: HarnessId) => Promise<HarnessAccount> } = {};
/** For tests: the environment the checks run in (each Mac in one process has its own), or a reader that stands in for them. */
export function configureAccounts(o: typeof options) {
  Object.assign(options, o);
}

// ---------- the readers, with I/O ----------

/** Run a CLI for its stdout. Never rejects: a missing binary is `missing`, anything else that fails is null. */
function run(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string | null; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(bin, args, { env, timeout: CHECK_MS, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' }, (err, stdout) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT' || code === 'EACCES') return resolve({ stdout: null, missing: true });
      // A CLI that says it is signed out may exit non-zero: its output still answers.
      resolve({ stdout: stdout?.trim() ? stdout : null, missing: false });
    });
  });
}

const baseEnv = () => options.env ?? process.env;

async function readClaude(): Promise<HarnessAccount> {
  const out = await run(config.claudeBin, ['auth', 'status', '--json'], harnessEnv('claude-code', {}, {}, baseEnv()));
  if (out.missing) return account('claude-code', 'not-installed');
  return out.stdout ? parseClaudeStatus(out.stdout) : account('claude-code', 'unknown', { note: 'claude auth status did not answer' });
}

async function readCodex(): Promise<HarnessAccount> {
  const bin = codexBin(baseEnv());
  if (!bin) return account('codex', 'not-installed');
  return await new Promise<HarnessAccount>((resolve) => {
    let settled = false;
    const failed = account('codex', 'unknown', { note: 'codex app-server did not answer' });
    const client = new CodexClient({ bin, env: harnessEnv('codex', {}, {}, baseEnv()), requestTimeoutMs: CHECK_MS, onExit: () => finish(failed) });
    const finish = (a: HarnessAccount) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.kill();
      resolve(a);
    };
    client.child.on('error', (err: NodeJS.ErrnoException) => finish(err.code === 'ENOENT' ? account('codex', 'not-installed') : failed));
    const timer = setTimeout(() => finish(failed), CHECK_MS);
    (async () => {
      await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
      client.notify('initialized', {});
      finish(parseCodexAccount(await client.request<GetAccountResponse>('account/read', {})));
    })().catch(() => finish(failed));
  });
}

async function readCursor(): Promise<HarnessAccount> {
  const bin = cursorBin(baseEnv());
  if (!bin) return account('cursor', 'not-installed');
  const out = await run(bin, ['about', '--format', 'json'], harnessEnv('cursor', {}, {}, baseEnv()));
  if (out.missing) return account('cursor', 'not-installed');
  return out.stdout ? parseCursorAbout(out.stdout) : account('cursor', 'unknown', { note: 'cursor-agent about did not answer' });
}

async function readCursorCloud(): Promise<HarnessAccount> {
  const key = await globalSecret('CURSOR_API_KEY').catch(() => null);
  if (!key) return account('cursor-cloud', 'off', { note: 'No CURSOR_API_KEY in Secrets' });
  try {
    return parseCursorMe(await new CursorCloudClient(key, config.cursorApiUrl).me(AbortSignal.timeout(CHECK_MS)));
  } catch (e) {
    const status = (e as { status?: number }).status;
    return status === 401
      ? account('cursor-cloud', 'signed-out', { note: 'Cursor refused CURSOR_API_KEY' })
      : account('cursor-cloud', 'unknown', { note: 'The Cursor API did not answer' });
  }
}

async function readHermes(): Promise<HarnessAccount> {
  const url = config.hermesUrl;
  const key = url ? await globalSecret('HERMES_API_KEY').catch(() => null) : null;
  if (!url || !key) return account('hermes', 'off', { note: 'No Hermes URL or HERMES_API_KEY' });
  let host = 'the Hermes server';
  try {
    host = new URL(url).host;
  } catch {
    // Keep the generic name.
  }
  const up = await probeHermes(url, key, CHECK_MS).catch(() => false);
  return up
    ? account('hermes', 'not-reported', { note: `Bills the API key set on ${host}` })
    : account('hermes', 'unknown', { note: `${host} did not answer` });
}

const READERS: Record<HarnessId, () => Promise<HarnessAccount>> = {
  'claude-code': readClaude,
  codex: readCodex,
  cursor: readCursor,
  'cursor-cloud': readCursorCloud,
  hermes: readHermes,
};

/** One harness's reading, cleaned whatever its reader returned. A reader that throws reads as unknown. */
async function readOne(harness: HarnessId): Promise<HarnessAccount> {
  const read = options.read ?? ((h: HarnessId) => READERS[h]());
  try {
    return sanitize(await read(harness), harness);
  } catch {
    return account(harness, 'unknown', { note: 'The check failed' });
  }
}

// ---------- this machine's record ----------

const selfId = () => outbox.machineId() ?? LOCAL_ID;
const keyOf = (id: string) => (id === LOCAL_ID ? LOCAL_KEY : `${ACCOUNTS_PREFIX}${id}`);

function parseRecord(id: string, v: unknown): MachineAccountsRecord | null {
  const r = v as Partial<MachineAccountsRecord> | null;
  if (!r || typeof r.name !== 'string' || typeof r.checkedAt !== 'string' || !Array.isArray(r.accounts)) return null;
  const accounts = r.accounts.flatMap((a) => {
    const h = (a as { harness?: unknown })?.harness;
    return typeof h === 'string' && /^[a-z-]{1,40}$/.test(h) ? [sanitize(a, h)] : [];
  });
  return { id, name: clean(r.name, 80) ?? id, checkedAt: r.checkedAt, accounts };
}

/** The record this machine wrote last: under its sync id, or the local key from before sync gave it one. */
const storedOwn = (): MachineAccountsRecord | null =>
  parseRecord(selfId(), kv.get<unknown>(keyOf(selfId()))) ?? (selfId() === LOCAL_ID ? null : parseRecord(selfId(), kv.get<unknown>(LOCAL_KEY)));

let own: { record: MachineAccountsRecord; at: number } | null = null;
let reading: Promise<MachineAccountsRecord> | null = null;

/** The record's content, without the time it was read: what decides whether it changed. */
const content = (r: MachineAccountsRecord) => JSON.stringify([r.name, r.accounts]);

async function readOwn(): Promise<MachineAccountsRecord> {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const prev = own?.record ?? storedOwn();
  const [name, ...readings] = await Promise.all([computerName(), ...HARNESS_IDS.map(readOne)]);
  const accounts = readings.map((r) => nextAccount(prev?.accounts.find((a) => a.harness === r.harness), r, at));
  const record: MachineAccountsRecord = { id: selfId(), name, checkedAt: at, accounts };
  const changed = !!prev && content(prev) !== content(record);
  const stored = parseRecord(record.id, kv.get<unknown>(keyOf(record.id)));
  if (!stored || content(stored) !== content(record) || now - Date.parse(stored.checkedAt) > REWRITE_MS) kv.set(keyOf(record.id), record);
  own = { record, at: now };
  // The first reading is no news: clients asked for it. A change is, wherever it shows.
  if (changed) publishFeed({ type: 'accounts' });
  return record;
}

/** This machine's accounts: the last reading while it is fresh, else a new one. Calls during a reading join it. */
export function ownAccounts({ force = false }: { force?: boolean } = {}): Promise<MachineAccountsRecord> {
  if (reading) return reading;
  if (!force && own && Date.now() - own.at < FRESH_MS) return Promise.resolve(own.record);
  reading = readOwn().finally(() => {
    reading = null;
  });
  return reading;
}

/** After a sync: read again when the last reading is old, so a switch here reaches the other machines. */
export function refreshAfterSync(now = Date.now()) {
  if (reading || (own && now - own.at < SYNC_EVERY_MS)) return;
  void ownAccounts({ force: true }).catch((err) => console.error('[accounts] could not read the harness accounts:', (err as Error).message));
}

// ---------- every machine ----------

const seenOf = (machine: string, harness: string) => {
  const v = kv.get<unknown>(seenKey(machine, harness));
  return typeof v === 'string' ? v : null;
};

const viewOf = (r: MachineAccountsRecord, current: boolean): MachineAccounts => ({
  id: r.id,
  name: r.name,
  current,
  checkedAt: r.checkedAt,
  accounts: r.accounts.map(({ last: _last, ...a }) => ({ ...a, notice: switchNotice(a, seenOf(r.id, a.harness)) })),
});

/** The other machines' records: each synced machine that is still current (one per Tailscale node), by name. */
function otherRecords(self: string): MachineAccountsRecord[] {
  const machines = new Set(currentRecords(deviceRecords()).map((d) => d.id));
  return kv
    .list<unknown>(ACCOUNTS_PREFIX)
    .flatMap(([key, v]) => {
      const id = key.slice(ACCOUNTS_PREFIX.length);
      if (id === self || !machines.has(id)) return [];
      return parseRecord(id, v) ?? [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** GET /api/accounts. `refresh` reads this machine again (joining a reading under way) instead of the last one. */
export async function accountsView({ refresh = false }: { refresh?: boolean } = {}): Promise<AccountsView> {
  const mine = await ownAccounts({ force: refresh });
  const self = outbox.machineId();
  const synced = !!self && !!activeWorker();
  return { machines: [viewOf(mine, true), ...(synced ? otherRecords(self).map((r) => viewOf(r, false)) : [])], synced };
}

const refused = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Acknowledge the switch shown for a harness on a machine: its notice goes until the next switch. */
export async function acknowledgeSwitch(machine: string, harness: string): Promise<AccountsView> {
  const view = await accountsView();
  const m = view.machines.find((x) => x.id === machine);
  const a = m?.accounts.find((x) => x.harness === harness);
  if (!m || !a) throw refused('No account is listed for that harness on that machine.', 404);
  const key = identityKey(a);
  if (key && seenOf(machine, harness) !== key) kv.set(seenKey(machine, harness), key);
  return accountsView();
}

// ---------- threads ----------

const ranKey = (threadId: string) => `${RAN_PREFIX}${threadId}`;

function parseRan(v: unknown): ThreadAccount | null {
  const t = v as Partial<ThreadAccount> | null;
  const label = clean(t?.label);
  if (!t || !label || typeof t.harness !== 'string' || typeof t.machine !== 'string' || typeof t.at !== 'string') return null;
  return { harness: t.harness, machine: t.machine, machineName: clean(t.machineName, 80) ?? t.machine, label, org: clean(t.org), plan: clean(t.plan, 40), at: t.at };
}

/** The account a thread last ran as, wherever it ran. Null before its first process started since this build. */
export const threadAccount = (threadId: string): ThreadAccount | null => parseRan(kv.get<unknown>(ranKey(threadId)));

/**
 * Stamp a thread with the account its harness runs as here, as its process starts. Uses the last reading (read again
 * when stale) and never holds up the start. Written only when it differs from the stamp the thread has.
 */
export function stampThread(threadId: string, harness: string): void {
  void ownAccounts()
    .then((r) => {
      const a = r.accounts.find((x) => x.harness === harness);
      if (!a || a.state !== 'signed-in' || !a.label) return;
      const had = threadAccount(threadId);
      const same = had && had.machine === r.id && had.harness === harness && identityKey(had) === identityKey(a) && had.plan === a.plan;
      if (same) return;
      kv.set(ranKey(threadId), { harness, machine: r.id, machineName: r.name, label: a.label, org: a.org, plan: a.plan, at: new Date().toISOString() } satisfies ThreadAccount);
      publishFeed({ type: 'accounts' });
    })
    .catch((err) => console.error('[accounts] could not stamp the thread:', (err as Error).message));
}

onSynced(() => refreshAfterSync());
