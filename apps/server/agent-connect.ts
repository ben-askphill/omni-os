// Connect an agent (docs/plans/2026-11-18-connect-an-agent.md, C1): find what answers at an address, sign in to it
// with a pairing code (or a key already in Secrets), run one test turn, and only then save it as a custom harness
// (harness/custom.ts), with its key in the secret store and, by default, a starter crew role bound to it.
//
// - Every call to the agent is a GET or POST with a 5-second timeout (60 for the test turn) and no redirects followed,
//   to the host Ben typed or the link named. Plain http:// only to this machine or the tailnet (custom.ts urlProblem).
// - A paired key stays on the server: it is held in memory under a draft id between Sign in and Connect, written
//   straight to the secret store on Connect, and never sent to a client.
// - What the agent says (its name, its reply) is untrusted text: cut to printable characters and a length cap.
// - Connect saves the secret, then the harness file, then the role. A failure at any step undoes the steps before it
//   and revokes a key the agent can revoke, so nothing half-made stays.
import { randomUUID } from 'node:crypto';
import { CUSTOM_HARNESS_SLUG } from '@omni/shared/custom-harness.ts';
import { agentKeyName, groupedCode, normalizeCode, type AgentTest, type ConnectInput, type FoundAgent, type PairedAgent } from '@omni/shared/connect-agent.ts';
import { about } from './about.ts';
import { outbox } from './db.ts';
import { crewTexts } from './crew.ts';
import { deleteCrew, saveCrew, type CrewSaveContext } from './crew-store.ts';
import { checkCustomHarness } from './harness/catalog-service.ts';
import { customHarness, customHarnesses, loopback, secretProblem, tailnet, urlProblem, type CustomHarness } from './harness/custom.ts';
import { deleteCustomHarness, saveCustomHarness } from './harness/custom-store.ts';
import { HermesClient, HermesHttpError, probeRunsApi } from './harness/hermes/client.ts';
import { deleteSecret, globalSecret, hasSecret, setSecret } from './secrets.ts';

const refused = (message: string, status: 400 | 404 | 409 | 502 = 400) => Object.assign(new Error(message), { status });

const PROBE_MS = 5000;
const TEST_MS = 60_000;
/** How long a paired key or a passed test waits for Connect. */
const DRAFT_MS = 15 * 60_000;
const MAX_DRAFTS = 10;
const TEST_PROMPT = 'Omni is checking the connection. Reply with one line: your name and the model you run on.';
/** The most of the test turn's reply Omni keeps: the sheet shows its first line or two. */
const REPLY_CAP = 4000;

/** Printable text only, and short. */
const plain = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};
const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
};
const base = (url: string) => url.trim().replace(/\/+$/, '');

/** The most of an answer's body Omni reads: an agent's card or pairing answer is a few hundred bytes. */
const BODY_CAP = 64 * 1024;

/**
 * An answer's body as text, read only up to `cap` bytes: null once it passes that (the rest is not read) or when it
 * cannot be read. An address Ben pasted can answer with anything, so nothing here waits for a whole large body.
 */
export async function readCapped(res: Response, cap = BODY_CAP): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > cap) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      parts.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(parts).toString('utf8');
}

/** A GET with no credentials, a short timeout and no redirects. Null when nothing answered. */
async function get(url: string, timeoutMs = PROBE_MS): Promise<{ status: number; json: unknown } | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const text = res.status === 200 ? await readCapped(res) : (await res.body?.cancel().catch(() => {}), '');
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: the status alone says what answered.
    }
    return { status: res.status, json };
  } catch {
    return null;
  }
}

// ---------- find ----------

const RUNS_CAN = ['Steer', 'Stop', 'Tool rows', 'Token counts'];
const REMOTE_CANNOT = ['Worktree', 'Browser', 'Omni tools'];

const unreachable = (host: string) =>
  `Could not reach ${host} from this machine. On the tailnet, check this machine is on it too; outside it, the agent needs https (Tailscale Funnel, a tunnel or a proxy).`;

function networkOf(url: string): FoundAgent['network'] {
  const h = hostnameOf(url);
  if (loopback(h)) return 'local';
  return tailnet(h) ? 'tailnet' : 'https';
}

/** A pairing address and a Runs API address must be on the same host: a link cannot send the key to another one. */
function pairProblem(url: string | undefined, pair: string | undefined): string | null {
  if (!pair) return null;
  const p = urlProblem(pair);
  if (p) return `Pairing address: ${p}`;
  if (url && hostnameOf(url) !== hostnameOf(pair)) return `The pairing address (${hostOf(pair)}) is on another host than the agent (${hostOf(url)}), so Omni will not send it a code.`;
  return null;
}

/** The Runs API answer to GET /v1/capabilities without a key: Hermes answers 200 or 401. */
function runsApiName(json: unknown, host: string): string {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const named = plain(o.name, 80);
  if (named) return named;
  return o.platform === 'hermes-agent' ? `Hermes on ${host.split(':')[0].split('.')[0]}` : `Agent on ${host}`;
}

/**
 * Probe an address in a fixed order: the Runs API (`/v1/capabilities`), a pairing address alone (`/v1/omni/pair`
 * answers a GET with 405), an A2A card, then eve's health route. Never with a key, never following a redirect.
 */
export async function findAgent(given: ConnectInput): Promise<FoundAgent> {
  const url = given.url ? base(given.url) : '';
  const pair = given.pair ? base(given.pair) : undefined;
  const at = url || pair || '';
  const host = hostOf(at);
  const empty: FoundAgent = { url, ...(pair && { pair }), host, name: plain(given.name, 80) || host, kind: 'runs-api', supported: false, signIn: 'key', network: networkOf(at), can: [], cannot: REMOTE_CANNOT, warnings: [] };
  if (!at) return { ...empty, problem: given.code ? "Add the agent's address too. A code alone has no host in it, on purpose." : "Paste the agent's address or the link its pairing helper printed." };
  const bad = urlProblem(at) ?? pairProblem(url || undefined, pair);
  if (bad) return { ...empty, problem: bad };
  const hasCode = !!(given.code && normalizeCode(given.code));
  const warnings: string[] = [];
  if (given.code && !hasCode) warnings.push('That pairing code does not look right: it is letters and digits in groups of four.');

  // A2A card URL pasted as is.
  if (/\/\.well-known\/agent-card\.json$/.test(new URL(at).pathname)) return a2a(empty, await get(at), warnings);

  const caps = url ? await get(`${url}/v1/capabilities`) : null;
  if (caps && [200, 401, 403].includes(caps.status)) {
    // Pairs at its own address when it serves the route, or at the helper the link named.
    const pairsHere = !pair && (await get(`${url}/v1/omni/pair`))?.status === 405;
    const name = plain(given.name, 80) || runsApiName(caps.json, host);
    return { ...empty, name, kind: 'runs-api', supported: true, signIn: hasCode && (pair || pairsHere) ? 'pairing' : 'key', can: RUNS_CAN, warnings };
  }
  // A pairing address on its own (the helper's "Address"): runs go where its answer says.
  const pairOnly = await get(`${at}/v1/omni/pair`);
  if (pairOnly?.status === 405) {
    return { ...empty, url: '', pair: at, name: plain(given.name, 80) || `Agent on ${host}`, kind: 'pairing', supported: true, signIn: 'pairing', can: RUNS_CAN, warnings, ...(!hasCode && { problem: 'This is a pairing address. Add the code its helper printed.' }) };
  }
  const card = await get(`${at}/.well-known/agent-card.json`);
  if (card?.status === 200 && card.json && typeof card.json === 'object') return a2a(empty, card, warnings);
  const eve = await get(`${at}/eve/v1/health`);
  if (eve?.status === 200) return { ...empty, kind: 'eve', name: plain(given.name, 80) || `eve agent on ${host}`, problem: 'This is an eve agent. Omni connects eve agents through A2A or a Runs API template in a later version.' };
  if (!caps && !pairOnly && !card && !eve) return { ...empty, problem: unreachable(host) };
  return { ...empty, problem: `${host} answered, but not as an agent Omni can run threads on (no Runs API at /v1/capabilities, no A2A card).` };
}

function a2a(empty: FoundAgent, card: { status: number; json: unknown } | null, warnings: string[]): FoundAgent {
  if (!card || card.status !== 200) return { ...empty, problem: unreachable(empty.host) };
  const c = (card.json ?? {}) as Record<string, unknown>;
  return {
    ...empty,
    kind: 'a2a',
    name: plain(c.name, 80) || `A2A agent on ${empty.host}`,
    ...(plain(c.description, 300) && { description: plain(c.description, 300) }),
    warnings: [...warnings, ...(Array.isArray(c.signatures) && c.signatures.length ? [] : ['Its card is not signed.'])],
    problem: 'This is an A2A agent. Omni runs threads on A2A agents in a later version; for now an agent connects through the Runs API.',
  };
}

// ---------- drafts: a paired key or a passed test, waiting for Connect ----------

interface Draft {
  id: string;
  url: string;
  name: string;
  key: string;
  keyId: string;
  sharedKey: boolean;
  revoke: boolean;
  /** Where it paired, which revokes the key a failed Connect leaves behind. */
  pair: string;
  tested: boolean;
  expires: number;
}

const drafts = new Map<string, Draft>();
/** Manual connections (a URL and a secret) whose test passed, by `url\nsecret`, with when. */
const testedManual = new Map<string, number>();

function prune(now = Date.now()) {
  for (const [id, d] of drafts) if (now >= d.expires) drafts.delete(id);
  for (const [k, at] of testedManual) if (now - at >= DRAFT_MS) testedManual.delete(k);
}

const draftOf = (id: string | undefined) => {
  prune();
  const d = id ? drafts.get(id) : undefined;
  if (!d) throw refused('The pairing expired or this Omni restarted. Run the pairing helper again for a new code.', 404);
  return d;
};

/** For tests: forget drafts and passed tests. */
export function resetConnectDrafts() {
  drafts.clear();
  testedManual.clear();
}

// ---------- sign in: pairing ----------

/** This machine, as the agent will list who paired. */
const client = () => ({ client_id: outbox.machineId() ?? `omni-${about.name}`, client_name: `Omni on ${about.name.split('.')[0]}` });

/**
 * Redeem a pairing code at the agent (POST /v1/omni/pair), server to server. The key it answers with stays in memory
 * here under a draft id; the answer's `url`, when it names one, must be on the pairing address's own host.
 */
export async function pairAgent(given: { url?: string; pair?: string; code: string; name?: string }): Promise<PairedAgent> {
  const url = given.url ? base(given.url) : '';
  const pair = given.pair ? base(given.pair) : url;
  if (!pair) throw refused("Add the agent's address.");
  const bad = urlProblem(pair) ?? (url ? urlProblem(url) : null) ?? pairProblem(url || undefined, pair === url ? undefined : pair);
  if (bad) throw refused(bad);
  const code = normalizeCode(given.code ?? '');
  if (!code) throw refused('That is not a pairing code: it is letters and digits in groups of four, as the helper printed it.');
  prune();
  if (drafts.size >= MAX_DRAFTS) throw refused('Too many pairings are waiting to be connected. Finish or close one first.', 409);
  let res: Response;
  try {
    res = await fetch(`${pair}/v1/omni/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: groupedCode(code), ...client() }),
      signal: AbortSignal.timeout(PROBE_MS * 2),
      redirect: 'manual',
    });
  } catch {
    throw refused(unreachable(hostOf(pair)), 502);
  }
  const text = (await readCapped(res)) ?? '';
  if (res.status === 404) throw refused('The agent did not take the code: it is wrong, used or expired. Run the pairing helper again for a new one.');
  if (res.status === 429) throw refused('The agent refused more codes from this machine for now: too many wrong ones. Run the helper again.', 409);
  if (res.status !== 200) throw refused(`The agent answered HTTP ${res.status} to the pairing call.`, 502);
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw refused('The agent answered the pairing call with something that is not JSON.', 502);
  }
  const key = typeof a.key === 'string' ? a.key : '';
  if (!key || key.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(key)) throw refused('The agent answered without a usable key.', 502);
  const runs = typeof a.url === 'string' && a.url ? base(a.url) : url || pair;
  const runsBad = urlProblem(runs);
  if (runsBad) throw refused(`The agent named an address Omni will not use: ${runsBad}`, 502);
  if (hostnameOf(runs) !== hostnameOf(pair)) throw refused(`The agent named ${hostOf(runs)} for its runs, another host than the one it paired on, so Omni did not keep the key.`, 502);
  const d: Draft = {
    id: randomUUID(),
    url: runs,
    name: plain(a.name, 80) || plain(given.name, 80) || `Agent on ${hostOf(runs)}`,
    key,
    keyId: plain(a.key_id, 200),
    sharedKey: a.shared_key === true,
    revoke: a.revoke === true,
    pair,
    tested: false,
    expires: Date.now() + DRAFT_MS,
  };
  drafts.set(d.id, d);
  return { draft: d.id, url: d.url, host: hostOf(d.url), name: d.name, sharedKey: d.sharedKey, revoke: d.revoke };
}

/** Revoke a key at the pairing address that minted it (POST /v1/omni/revoke). False when it did not answer 2xx. */
async function revokeAt(url: string, key: string, keyId: string): Promise<boolean> {
  if (urlProblem(url)) return false;
  try {
    const res = await fetch(`${base(url)}/v1/omni/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: keyId }),
      signal: AbortSignal.timeout(PROBE_MS),
      redirect: 'manual',
    });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- test ----------

/**
 * A signed-in probe, then one short turn on a session of its own, ended after. The reply, the model it named and the
 * time it took come back; a failure says which step and what came back.
 */
export async function testAgent(url: string, key: string, timeoutMs = TEST_MS): Promise<AgentTest> {
  const probe = await probeRunsApi(url, key);
  if (probe.state === 'rejected') return { ok: false, failed: 'probe', detail: `${hostOf(url)} refused the key (HTTP 401 or 403).` };
  if (probe.state === 'status') return { ok: false, failed: 'probe', detail: `${hostOf(url)} answered HTTP ${probe.status} to GET /v1/capabilities.` };
  if (probe.state === 'unreachable') return { ok: false, failed: 'probe', detail: unreachable(hostOf(url)) };
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const api = new HermesClient(url, key);
  let runId = '';
  let reply = '';
  let ended = false;
  let firstEventMs: number | undefined;
  const out: AgentTest = { ok: false };
  try {
    const run = await api.createRun({ input: TEST_PROMPT, session_id: `omni-test-${randomUUID()}` }, randomUUID(), ac.signal);
    runId = run.run_id;
    for await (const raw of api.events(runId, ac.signal)) {
      firstEventMs ??= Date.now() - started;
      const e = (raw ?? {}) as Record<string, unknown>;
      // Only the start of the reply is shown: an agent that streams on does not grow it past that.
      if (e.event === 'message.delta' && typeof e.delta === 'string' && reply.length < REPLY_CAP) reply += e.delta.slice(0, REPLY_CAP - reply.length);
      if (e.event === 'run.completed') {
        ended = true;
        const usage = (e.usage ?? {}) as Record<string, unknown>;
        const runtime = (e.runtime ?? {}) as Record<string, unknown>;
        Object.assign(out, {
          ok: true,
          reply: plain((typeof e.output === 'string' && e.output) || reply, 500),
          ...(plain(runtime.model, 120) && { model: plain(runtime.model, 120) }),
          ...(typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number' && { tokens: { input: usage.input_tokens, output: usage.output_tokens } }),
        });
        break;
      }
      if (e.event === 'run.failed' || e.event === 'run.cancelled' || e.event === 'run.interrupted') {
        ended = true;
        Object.assign(out, { ok: false, failed: 'turn', detail: `The test turn ended with ${String(e.event).slice(4)}${typeof e.error === 'string' ? `: ${plain(e.error, 200)}` : ''}.` });
        break;
      }
    }
    if (!ended) {
      // The stream closed without an ending: ask once how the run went.
      const r = await api.getRun(runId, ac.signal);
      if (r.status === 'completed') Object.assign(out, { ok: true, reply: plain(r.output || reply, 500), ...(plain(r.runtime?.model, 120) && { model: plain(r.runtime?.model, 120) }) });
      else Object.assign(out, { ok: false, failed: 'turn', detail: `The test turn did not finish (status ${plain(r.status, 40) || 'unknown'}).` });
      ended = r.status !== 'running' && r.status !== 'queued';
    }
  } catch (e) {
    Object.assign(out, {
      ok: false,
      failed: 'turn',
      detail: ac.signal.aborted ? `No answer within ${Math.round(timeoutMs / 1000)} seconds.` : e instanceof HermesHttpError ? `The agent answered HTTP ${e.status} to the test turn.` : 'The test turn failed before the agent answered.',
    });
  } finally {
    clearTimeout(timer);
    // Never leave the test's run going on the agent.
    if (runId && !ended) await api.stop(runId).catch(() => {});
  }
  return { ...out, ...(firstEventMs !== undefined && { firstEventMs }), totalMs: Date.now() - started };
}

/** Test a paired draft, or a URL with a key already in Secrets. A pass is what Connect waits for. */
export async function testConnection(given: { draft?: string; url?: string; secret?: string }): Promise<AgentTest> {
  if (given.draft) {
    const d = draftOf(given.draft);
    const r = await testAgent(d.url, d.key);
    d.tested = r.ok;
    return r;
  }
  const { url, key, tested } = await manual(given.url, given.secret);
  const r = await testAgent(url, key);
  if (r.ok) testedManual.set(tested, Date.now());
  return r;
}

/** A URL and a secret from Secrets, checked, with the key read from this machine's store. */
async function manual(rawUrl: string | undefined, secret: string | undefined) {
  const url = base(rawUrl ?? '');
  const bad = urlProblem(url) ?? secretProblem(secret ?? '');
  if (bad) throw refused(bad);
  const key = await globalSecret(secret!).catch(() => null);
  if (!key) throw refused(`${secret} is not set in Secrets on this machine. Add the agent's key there first.`);
  return { url, key, tested: `${url}\n${secret}` };
}

// ---------- connect ----------

export interface ConnectRequest {
  slug: string;
  name: string;
  /** A paired draft, or `url` with `secret` for a key already in Secrets. */
  draft?: string;
  url?: string;
  secret?: string;
  bills?: string;
  /** Make a crew role bound to it (decision F8, on by default). */
  role: boolean;
}

export interface Connected {
  harness: CustomHarness;
  role: { id: string; name: string } | null;
}

/** A role id that is free: the slug, else the slug with a number. */
function freeRoleId(slug: string): string {
  for (let i = 1; i < 100; i++) {
    const id = i === 1 ? slug : `${slug}-${i}`;
    const { shipped, own } = crewTexts(id);
    if (shipped === null && own === null) return id;
  }
  throw refused('Could not find a free id for the crew role. Untick Make a crew role, or remove some roles.', 409);
}

/** The starter role's charter. {{user}} is filled in when a thread starts. */
const starterCharter = (name: string) =>
  `You are ${name}, a remote agent working for {{user}} through Omni. Your replies go back to the thread that asked: answer the question in it, say what you checked, and keep it short.`;

/**
 * Save a connected agent, only after its test passed: the key into the secret store (a paired one, as
 * AGENT_<SLUG>_KEY), the harness file, then the starter role. A failure undoes what was made and revokes the key.
 */
export async function connectAgent(req: ConnectRequest, ctx: () => CrewSaveContext): Promise<Connected> {
  if (!CUSTOM_HARNESS_SLUG.test(req.slug)) throw refused('The id is lowercase letters, digits and dashes, up to 48 characters.');
  if (customHarness(`custom:${req.slug}`)) throw refused(`A custom harness "${req.slug}" already exists. Pick another id.`, 409);
  const name = plain(req.name, 80);
  if (!name) throw refused('Give the agent a name.');
  prune();
  const d = req.draft ? draftOf(req.draft) : null;
  const m = d ? null : await manual(req.url, req.secret);
  if (d ? !d.tested : !testedManual.has(m!.tested)) throw refused('Run the test first: Omni connects an agent only once a test turn passed.', 409);
  const secret = d ? agentKeyName(req.slug) : req.secret!;
  if (d && hasSecret('global', secret)) throw refused(`A secret named ${secret} already exists. Pick another id, or remove that secret first.`, 409);

  const made: { secret?: string; harness?: string; role?: string } = {};
  try {
    if (d) {
      await setSecret('global', secret, d.key);
      made.secret = secret;
    }
    const harness = saveCustomHarness(
      req.slug,
      { name, url: d ? d.url : m!.url, secret, ...(req.bills?.trim() && { bills: req.bills.trim().slice(0, 160) }) },
      { create: true, ...(d && { pairing: { keyId: d.keyId, at: d.pair, sharedKey: d.sharedKey, revoke: d.revoke, secretMade: true, secret } }) },
    );
    made.harness = req.slug;
    // The catalog lists it once probed, which a role bound to it is checked against.
    await checkCustomHarness(harness.id);
    let role: Connected['role'] = null;
    if (req.role) {
      const id = freeRoleId(req.slug);
      const saved = saveCrew(id, { fields: { name, description: `${name}, a remote agent on ${harness.host}.`, harness: harness.id, model: 'default', delegatable: true }, charter: starterCharter(name) }, ctx(), { create: true });
      made.role = id;
      role = { id, name: saved.role.name };
    }
    if (d) drafts.delete(d.id);
    else testedManual.delete(m!.tested);
    return { harness, role };
  } catch (e) {
    if (made.role) {
      try {
        deleteCrew(made.role);
      } catch {
        // Gone already.
      }
    }
    if (made.harness) {
      try {
        deleteCustomHarness(made.harness);
      } catch {
        // Gone already.
      }
    }
    if (made.secret) await deleteSecret('global', made.secret).catch(() => {});
    if (d?.revoke && d.keyId) await revokeAt(d.pair, d.key, d.keyId);
    if (d) drafts.delete(d.id);
    throw e;
  }
}

// ---------- remove ----------

export interface Removed {
  deleted: true;
  /** The agent revoked the key (it offers /v1/omni/revoke), or null when it does not offer that. */
  revoked: boolean | null;
  /** The secret Omni had made for it and deleted, or null. */
  secret: string | null;
}

/**
 * A harness file's pairing record, when Remove may act on it: the file runs as written, still names the secret the
 * paired key went into, and its revoke address is a fine one on the agent's own host. Otherwise Remove only deletes the
 * file, so a stale or hand-edited record never sends a key elsewhere or deletes a secret it did not make.
 */
function pairingOf(h: CustomHarness) {
  const p = h.pairing;
  if (!p || h.error || !p.secret || p.secret !== h.secret || secretProblem(h.secret)) return null;
  const at = p.at || h.url;
  return !urlProblem(at) && hostnameOf(at) === hostnameOf(h.url) ? p : null;
}

/**
 * Remove a custom harness: revoke its key at the agent when it offers that, delete the secret Connect made for it
 * (only when no other harness file names the same one), then delete the file here and on the other machines. Its
 * threads stay readable and refuse to run (registry.ts missingHarness).
 */
export async function removeAgent(slug: string): Promise<Removed> {
  const h = CUSTOM_HARNESS_SLUG.test(slug) ? customHarness(`custom:${slug}`) : null;
  if (!h) throw refused(`No custom harness "${slug}".`, 404);
  const p = pairingOf(h);
  const key = p?.revoke && p.keyId ? await globalSecret(h.secret).catch(() => null) : null;
  const revoked = p?.revoke && p.keyId ? (key ? await revokeAt(p.at || h.url, key, p.keyId) : false) : null;
  deleteCustomHarness(slug);
  const shared = customHarnesses().some((x) => x.secret === h.secret);
  const dropSecret = !!p?.secretMade && !shared && hasSecret('global', h.secret);
  if (dropSecret) await deleteSecret('global', h.secret);
  return { deleted: true, revoked, secret: dropSecret ? h.secret : null };
}

/** Test a saved custom harness with the key on this machine: the harness row's Test connection. */
export async function testSaved(slug: string): Promise<AgentTest> {
  const h = CUSTOM_HARNESS_SLUG.test(slug) ? customHarness(`custom:${slug}`) : null;
  if (!h) throw refused(`No custom harness "${slug}".`, 404);
  if (h.error) return { ok: false, failed: 'probe', detail: h.error };
  const key = await globalSecret(h.secret).catch(() => null);
  if (!key) return { ok: false, failed: 'probe', detail: `Key not on this machine: set ${h.secret} in Secrets.` };
  const r = await testAgent(h.url, key);
  await checkCustomHarness(h.id);
  return r;
}
