// The shadow agent router: for the first message of every new #conductor thread, ask Jev and Haiku which agents
// should take it, and log their picks beside what the Conductor did in that turn (agent_router_shadow, db/migrate.ts).
// It changes nothing: no agent is seated, no prompt changes, and the routers run after the thread has started, off
// the user's path. A router that is missing or fails logs its error and the other carries on. On only with
// OMNI_SHADOW_ROUTER=1. agreement.sql next to this file scores the log.
import { config } from '../config.ts';
import { listCrew } from '../crew.ts';
import { db, members, threads, type Thread, type ThreadStatus } from '../db.ts';
import { now } from '../db/connection.ts';
import { namedSecrets } from '../secrets.ts';
import { askClaude } from '../runner/aux.ts';
import { turnEnded } from '../runner/state.ts';
import { askJev, haikuAnswer, haikuPrompt, haikuSchema, haikuSystem, HAIKU_MODEL, JEV_MODEL, scrubbed, type RouterAgent, type RouterAnswer } from './routers.ts';

export const JEV_KEY = 'JEV_API_KEY';
const JEV_TIMEOUT_MS = 10_000;
const HAIKU_TIMEOUT_MS = 30_000;

/** What the shadow run reaches outside itself, swapped in tests. */
export interface ShadowDeps {
  enabled: () => boolean;
  /** The agents the Conductor can delegate to now, as list_crew lists them. */
  agents: () => RouterAgent[];
  /** The Jev key from the secret store, the #conductor channel's before the global one. Null when neither is set. */
  jevKey: () => Promise<string | null>;
  jev: (text: string, agents: RouterAgent[], key: string) => Promise<RouterAnswer>;
  /** Haiku through the Claude CLI: there is no Anthropic API key on the server, only the CLI's own sign-in. */
  haiku: (text: string, agents: RouterAgent[]) => Promise<RouterAnswer>;
}

export const delegatableAgents = (): RouterAgent[] =>
  listCrew()
    .filter((r) => r.delegatable && !r.hidden && !r.error && r.id !== 'conductor')
    .map((r) => ({ id: r.id, name: r.name, description: r.description }));

export const liveDeps: ShadowDeps = {
  enabled: () => config.shadowRouter,
  agents: delegatableAgents,
  jevKey: async () => (await namedSecrets('conductor', [JEV_KEY])).env[JEV_KEY] ?? null,
  jev: (text, agents, key) => askJev(text, agents, key, { url: config.jevApiUrl, timeoutMs: JEV_TIMEOUT_MS }),
  haiku: async (text, agents) =>
    haikuAnswer(
      await askClaude('omni-os-agent-router', haikuPrompt(text), HAIKU_TIMEOUT_MS, { model: HAIKU_MODEL, system: haikuSystem(agents), jsonSchema: haikuSchema(agents) }),
      agents,
    ),
};

/** A thread whose first message the Conductor routes: a new #conductor thread the user started, not a quick ask. */
export const routesFirstMessage = (t: Thread) =>
  t.channel_id === 'conductor' && t.role === 'conductor' && !t.parent_id && !t.quick && (t.source === 'manual' || t.source === 'capture');

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/**
 * Log what the routers would pick for a new thread's first message. Returns at once: only the row is saved now, so
 * the Conductor's pick finds it however fast its turn ends. The agents on offer are read, and the routers asked, on a
 * later tick. Never throws.
 */
export function shadowRoute(thread: Thread, prompt: string, deps: ShadowDeps = liveDeps): Promise<void> | null {
  try {
    if (!deps.enabled() || !routesFirstMessage(thread) || !prompt.trim()) return null;
    const at = now();
    db.prepare(`INSERT INTO agent_router_shadow (thread_id, message_at, agents, created_at, updated_at) VALUES (?, ?, '[]', ?, ?) ON CONFLICT(thread_id) DO NOTHING`).run(
      thread.id,
      thread.created_at,
      at,
      at,
    );
    return new Promise<void>((done) => setImmediate(done)).then(() => route(thread.id, prompt, deps));
  } catch (err) {
    console.error('[agent-router] could not start the shadow run:', (err as Error).message);
    return null;
  }
}

async function route(threadId: string, prompt: string, deps: ShadowDeps) {
  let agents: RouterAgent[];
  try {
    agents = deps.agents();
  } catch (err) {
    const error = scrubbed(`could not list the agents: ${errorText(err)}`);
    return save(threadId, { jev_model: JEV_MODEL, jev_error: error, haiku_model: HAIKU_MODEL, haiku_via: 'cli', haiku_error: error });
  }
  save(threadId, { agents: JSON.stringify(agents.map((a) => a.id)) });
  await Promise.all([runJev(threadId, prompt, agents, deps), runHaiku(threadId, prompt, agents, deps)]);
}

/** Write one router's columns. A shutdown may have closed the db by the time a router answers. */
function save(threadId: string, cols: Record<string, unknown>) {
  const keys = Object.keys(cols);
  try {
    db.prepare(`UPDATE agent_router_shadow SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE thread_id = ?`).run(
      ...(keys.map((k) => cols[k]) as (string | number | null)[]),
      now(),
      threadId,
    );
  } catch (err) {
    console.error('[agent-router] could not save a router answer:', (err as Error).message);
  }
}

async function runJev(threadId: string, prompt: string, agents: RouterAgent[], deps: ShadowDeps) {
  let key: string | null = null;
  // The call's own time, after the key is read.
  let t0 = performance.now();
  try {
    key = await deps.jevKey();
    if (!key) return save(threadId, { jev_model: JEV_MODEL, jev_error: `${JEV_KEY} is not set` });
    t0 = performance.now();
    const a = await deps.jev(prompt, agents, key);
    save(threadId, {
      jev_model: a.model,
      jev_picks: json(a.picks),
      jev_confidence: a.confidence,
      jev_scores: json(a.scores),
      jev_ms: Math.round(performance.now() - t0),
      jev_tokens: a.tokens ?? null,
    });
  } catch (err) {
    save(threadId, { jev_model: JEV_MODEL, jev_ms: Math.round(performance.now() - t0), jev_error: scrubbed(errorText(err), key) });
  }
}

async function runHaiku(threadId: string, prompt: string, agents: RouterAgent[], deps: ShadowDeps) {
  const t0 = performance.now();
  try {
    const a = await deps.haiku(prompt, agents);
    save(threadId, {
      haiku_model: a.model,
      haiku_via: 'cli',
      haiku_picks: json(a.picks),
      haiku_confidence: a.confidence,
      haiku_ms: Math.round(performance.now() - t0),
      haiku_cost_usd: a.costUsd ?? null,
    });
  } catch (err) {
    save(threadId, { haiku_model: HAIKU_MODEL, haiku_via: 'cli', haiku_ms: Math.round(performance.now() - t0), haiku_error: scrubbed(errorText(err)) });
  }
}

const errorText = (err: unknown) => {
  const e = err as Error & { cause?: { message?: string } };
  return e?.name === 'TimeoutError' ? 'timed out' : [e?.message, e?.cause?.message].filter(Boolean).join(': ') || String(err);
};

/**
 * What the Conductor picked in the turn that answered the first message: the agents of the threads it delegated
 * since (a team's members too) and the agents it seated in its own thread (seat_agents). Empty when it answered itself.
 */
export function conductorPicks(threadId: string, since: string): string[] {
  const picks: string[] = [];
  for (const child of threads.children(threadId)) {
    if (child.created_at < since || (child.source !== 'conductor' && child.source !== 'team')) continue;
    if (child.role) picks.push(child.role);
    if (child.source === 'team') for (const m of members.all(child.id)) if (!m.lead) picks.push(m.agent);
  }
  for (const m of members.all(threadId)) if (!m.lead && m.seated_at >= since) picks.push(m.agent);
  return [...new Set(picks)];
}

/** At the end of a logged thread's first turn: what the Conductor did. Later turns change nothing. */
export function recordConductor(threadId: string, status: ThreadStatus) {
  const row = db.prepare(`SELECT message_at FROM agent_router_shadow WHERE thread_id = ? AND conductor_at IS NULL`).get(threadId) as { message_at: string } | undefined;
  if (!row) return;
  const at = now();
  db.prepare(`UPDATE agent_router_shadow SET conductor_picks = ?, conductor_status = ?, conductor_at = ?, updated_at = ? WHERE thread_id = ? AND conductor_at IS NULL`).run(
    JSON.stringify(conductorPicks(threadId, row.message_at)),
    status,
    at,
    at,
    threadId,
  );
}

turnEnded.push(recordConductor);
