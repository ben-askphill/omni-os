// Remote agents (ADR 0020, group threads slice 4): an agent whose run is a server Omni reaches over HTTP, Hermes
// (`harness: hermes`, its URL in Settings and its key in HERMES_API_KEY) or a custom harness (`harness: custom:<slug>`,
// data/harnesses/<slug>.yaml, ADR 0017). The harness file, the key handling and the adapters stay as they were; what
// changes is that the agent is what Ben meets, and the server is a detail of it.
//
// - An agent is remote exactly when its file binds it to such a server, so a local agent an older file bound to one
//   (Builder on Hermes, say) is a remote agent with its own name and avatar (Q65).
// - Omni sends a remote agent a charter only when Ben wrote one in its file (Q28). Connect's old starter charter counts
//   as none.
// - At boot, threads on such a server become threads led by its agent, and a server with no agent gets one (Q26, Q27).
//   Both machines run the same steps, so nothing here is sent to the other one.
import { isCustomHarnessId } from '@omni/shared/custom-harness.ts';
import { isRemoteAgentHarness, type RemoteServer } from '@omni/shared/remote-agent.ts';
import YAML from 'yaml';
import { config } from './config.ts';
import { crewTexts, getCrew, listCrew, splitCrewFile, writeOwnCrew, CREW_ID, type CrewRole } from './crew.ts';
import { channels, db } from './db.ts';
import { record } from './db/sync.ts';
import { publishFeed } from './bus.ts';
import { fillPlaceholders } from './user-config.ts';
import type { Catalog } from './harness/catalog.ts';
import { customHarness, customHarnesses, pairable, PAIR_HERE_WHERE, type CustomHarness } from './harness/custom.ts';
import { hostOf } from './harness/catalog.ts';

export { isRemoteAgentHarness };

/** The catalog without remote agents' servers: what a local agent, a channel default and Auto may run on (Q33). */
export const localCatalog = (cat: Catalog): Catalog => ({ ...cat, harnesses: cat.harnesses.filter((h) => !isRemoteAgentHarness(h.id)) });

/** The agent's run is a remote server: Hermes or a custom harness. */
export const isRemoteAgent = (role: Pick<CrewRole, 'harness'> | null | undefined): boolean => !!role && isRemoteAgentHarness(role.harness);

/** The agent id a server's own agent has: `hermes`, or the custom harness's slug. */
const ownId = (harness: string) => (isCustomHarnessId(harness) ? harness.slice('custom:'.length) : harness);

/**
 * The remote agent whose server is `harness`: the one with the server's own id (hermes, the slug), else the first bound
 * to it. Undefined when no agent is.
 */
export function remoteAgentFor(harness: string | null | undefined, roles: readonly CrewRole[] = listCrew()): CrewRole | undefined {
  if (!harness || !isRemoteAgentHarness(harness)) return undefined;
  const bound = roles.filter((r) => r.harness === harness);
  return bound.find((r) => r.id === ownId(harness)) ?? bound[0];
}

/** A remote agent's server as its page shows it. Undefined for a local agent. */
export function serverOf(role: Pick<CrewRole, 'harness'>, cat: Catalog): RemoteServer | undefined {
  if (!isRemoteAgent(role)) return undefined;
  const harness = role.harness!;
  const info = cat.harnesses.find((h) => h.id === harness);
  if (harness === 'hermes') {
    const url = config.hermesUrl;
    return { harness, builtIn: true, kind: 'runs-api', url, host: hostOf(url), secret: 'HERMES_API_KEY', cap: info?.cap ?? 1, available: !!info?.available, ...(info?.fix && !info.available && { fix: info.fix }) };
  }
  const h: CustomHarness | null = customHarness(harness as `custom:${string}`);
  if (!h) return { harness, builtIn: false, kind: 'runs-api', url: '', host: '', secret: '', cap: 1, available: false, fix: 'Its server is not on this machine: it was removed, or has not synced here yet.' };
  const fix = h.error ?? (info && !info.available ? info.fix : undefined);
  const available = !h.error && !!info?.available;
  // Pair this machine only when the key is why: a server that is down needs no new key.
  const pairAt = !available && info?.remote?.keyProblem && pairable(h) ? h.pairing!.at || h.url : '';
  // The card is that page, with the button beside the line: no need to say where it is.
  const shown = pairAt && fix ? fix.replace(PAIR_HERE_WHERE, '') : fix;
  return { harness, builtIn: false, kind: h.kind, url: h.url, host: h.host, secret: h.secret, cap: h.cap, available, ...(shown && { fix: shown }), ...(pairAt && { pairAt }) };
}

/** The starter charter Connect wrote before slice 4 (agent-connect.ts), which Ben did not write. */
const STARTER = /^You are .{1,80}, a remote agent working for \{\{user\}\} through Omni\. Your replies go back to the thread that asked: answer the question in it, say what you checked, and keep it short\.$/;

/**
 * The charter Omni sends a remote agent: what Ben wrote in its file, placeholders filled, or '' (Q28). For a built-in
 * an overlay binds to a server, that is the overlay's body alone: the shipped charter was written for a local run.
 */
export function writtenCharter(role: CrewRole): string {
  const own = crewTexts(role.id).own;
  if (own === null) return '';
  const body = splitCrewFile(own).body.trim();
  return !body || STARTER.test(body) ? '' : fillPlaceholders(body);
}

/**
 * Remote agents can see this channel's work (Q36): other agents' replies and a catch-up when seated (Q37), and the
 * worktree read tool (worktree-read.ts). Off unless Ben turned it on, or the migration found an Ask that already sent a
 * remote agent an excerpt here (Q69).
 */
export function remoteSeesWork(channelId: string): boolean {
  return channels.get(channelId)?.remote_work === 1;
}

// ---------- conversion at boot ----------

/** A name no other agent has, ignoring case (agent names are unique, Q4). */
function freeName(name: string, roles: readonly CrewRole[]): string {
  const taken = new Set(roles.map((r) => r.name.trim().toLocaleLowerCase()));
  for (const n of [name, `${name} agent`, ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => `${name} ${i}`)]) if (!taken.has(n.toLocaleLowerCase())) return n;
  return `${name} ${Date.now()}`;
}

/** An agent id no file has: the server's own id, else with a number. */
function freeId(base: string): string | null {
  for (let i = 1; i < 100; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    if (!CREW_ID.test(id)) return null;
    const { shipped, own } = crewTexts(id);
    if (shipped === null && own === null) return id;
  }
  return null;
}

/** Write a new agent of Ben's own for a server, synced as any agent file is. */
function makeAgent(id: string, fields: Record<string, string>) {
  writeOwnCrew(id, `---\n${YAML.stringify(fields, { lineWidth: 0 })}---\n`);
  record('crew_file', id);
}

/** Hermes is set up or used here: a URL in Settings, a thread on it, or an agent bound to it. */
const hermesInUse = (roles: readonly CrewRole[]) =>
  !!config.hermesUrl || roles.some((r) => r.harness === 'hermes') || !!db.prepare(`SELECT 1 FROM threads WHERE harness = 'hermes' LIMIT 1`).get();

/**
 * Turn what came before slice 4 into remote agents, once per boot and idempotent: Hermes gets the agent `hermes`, a
 * custom harness no agent is bound to gets one with its name, and a thread on such a server that its own agent does not
 * lead is led by the server's agent from now on. A thread whose server has no agent here (a harness file not synced
 * yet) keeps its harness and refuses to run, as before.
 */
export function convertRemoteAgents(): { agents: string[]; threads: number } {
  const made: string[] = [];
  let roles = listCrew();
  if (!remoteAgentFor('hermes', roles) && hermesInUse(roles) && !getCrew('hermes')) {
    makeAgent('hermes', { name: freeName('Hermes', roles), description: 'Your Hermes server, reached over HTTP.', harness: 'hermes', model: 'hermes' });
    made.push('hermes');
    roles = listCrew();
  }
  for (const h of customHarnesses()) {
    if (remoteAgentFor(h.id, roles)) continue;
    const id = freeId(h.slug);
    if (!id) continue;
    makeAgent(id, { name: freeName(h.name, roles), description: `${h.name}, a remote agent on ${h.host || 'its own server'}.`, harness: h.id, model: 'default' });
    made.push(id);
    roles = listCrew();
  }
  let converted = 0;
  const rows = db.prepare(`SELECT id, harness, role FROM threads WHERE (harness = 'hermes' OR harness LIKE 'custom:%') AND source != 'member'`).all() as { id: string; harness: string; role: string | null }[];
  const set = db.prepare(`UPDATE threads SET role = ? WHERE id = ?`);
  for (const t of rows) {
    const lead = t.role ? roles.find((r) => r.id === t.role) : undefined;
    if (lead?.harness === t.harness) continue;
    const agent = remoteAgentFor(t.harness, roles);
    if (!agent) continue;
    set.run(agent.id, t.id);
    converted++;
  }
  if (made.length) publishFeed({ type: 'crew' });
  return { agents: made, threads: converted };
}
