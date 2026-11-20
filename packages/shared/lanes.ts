// Parallel turns (ADR 0019, Q55, Q62): a message several agents answer splits into a lane per agent, each with its
// steps, the files it changed and its latest line, and the collision flags raised meanwhile above the lanes. The
// lanes stay lanes in the history. From three agents they stack, each collapsed to its latest line; the phone shows
// one per tab. Pure: the fold's items in, the same items with each such turn's replies gathered into one `lanes` item.
import { editedPath, worktreePath, type Collision } from './collisions.ts';
import { plainCall } from './steps.ts';
import type { Item, ReplyItem, ToolCall, UserP } from './transcript-fold.ts';

/** Where one agent's lane stands: working until its turn's result, then how that turn ended. */
export type LaneState = 'working' | 'done' | 'failed' | 'stopped';

export interface Lane {
  agent: string;
  /** Its replies to the message, and the result that ended its turn. */
  items: Item[];
  /** The files its edit calls changed, relative to the worktree, each once in the order it first changed them. */
  files: string[];
  /** What it said or did last: the line a collapsed lane shows. */
  latest: string | null;
  state: LaneState;
}

export interface LanesItem {
  type: 'lanes';
  /** The key of the message the lanes answer, which comes right before them. */
  key: number;
  /** In the order the message named the agents. */
  lanes: Lane[];
  /** The collisions raised while the lanes ran. */
  flags: Collision[];
  /** Three agents or more: stacked, each collapsed to its latest line, not side by side. */
  stacked: boolean;
}

export type LaneFolded = Item | LanesItem;

const REPLY = new Set<Item['type']>(['text', 'tools', 'question', 'cloud']);
const OWNED = new Set<Item['type']>([...REPLY, 'result', 'error']);

const stateOf = (p: { ok?: boolean; stopped?: boolean }): LaneState => (p.stopped ? 'stopped' : p.ok ? 'done' : 'failed');

/** Every call in a group, its sub-agents' calls included, in order. */
function flat(calls: readonly ToolCall[]): ToolCall[] {
  return calls.flatMap((c) => [c, ...flat(c.children)]);
}

const lastLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) ?? null;

/** The line a lane collapses to: its last words, or the last step it took. */
function latestOf(items: readonly Item[]): string | null {
  for (const it of [...items].reverse()) {
    if (it.type === 'text') {
      const line = lastLine(it.p.text ?? '');
      if (line) return line;
    }
    if (it.type === 'tools') {
      const call = flat(it.calls).at(-1);
      if (call) return plainCall(call).now;
    }
    if (it.type === 'question') return 'Asking you a question';
    if (it.type === 'error') return lastLine(it.p.text ?? '') ?? 'Something went wrong';
  }
  return null;
}

function filesOf(items: readonly Item[], cwd: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const it of items) {
    if (it.type !== 'tools') continue;
    for (const c of flat(it.calls)) {
      const p = editedPath(c);
      if (p) out.add(worktreePath(p, cwd));
    }
  }
  return [...out];
}

/** The agents a message went to: those it names, else the lead. */
const recipientsOf = (p: UserP, lead: string) => {
  const to = (p as UserP & { to?: unknown }).to;
  return Array.isArray(to) ? [...new Set(to.filter((a): a is string => typeof a === 'string'))] : [lead];
};

/**
 * Gather each message that named two agents or more into one `lanes` item after it. An agent's replies join its lane
 * until the result that ends its turn, or until a later message goes to it, which takes its rows from then on out of
 * the lanes (the lane still takes how that turn ended). Collision rows raised while lanes run go above them. Every
 * other item stays where it was.
 */
export function laneFold(items: readonly Item[], { lead, cwd }: { lead: string | null | undefined; cwd?: string | null }): LaneFolded[] {
  const leadId = lead ?? '';
  const out: LaneFolded[] = [];
  /** Each agent's open lane, and the lane whose state a later result still settles. */
  const open = new Map<string, { block: LanesItem; lane: Lane }>();
  const settling = new Map<string, Lane>();
  const blocks: LanesItem[] = [];
  const author = (it: Item) => ('agent' in it && it.agent) || leadId;

  for (const it of items) {
    if (it.type === 'user') {
      // A message to an agent with an open lane takes it out of that lane from here on.
      for (const a of recipientsOf(it.p, leadId)) {
        const o = open.get(a);
        if (!o) continue;
        open.delete(a);
        if (o.lane.state === 'working') settling.set(a, o.lane);
      }
      out.push(it);
      const to = recipientsOf(it.p, leadId);
      if (to.length >= 2) {
        const block: LanesItem = { type: 'lanes', key: it.key, lanes: [], flags: [], stacked: to.length >= 3 };
        for (const agent of to) {
          const lane: Lane = { agent, items: [], files: [], latest: null, state: 'working' };
          block.lanes.push(lane);
          open.set(agent, { block, lane });
          settling.delete(agent);
        }
        blocks.push(block);
        out.push(block);
      }
      continue;
    }
    if (it.type === 'collision') {
      const running = [...open.values()].at(-1)?.block;
      if (running) {
        running.flags.push(it.c);
        continue;
      }
    }
    if (OWNED.has(it.type)) {
      const a = author(it);
      const o = open.get(a);
      if (o) {
        o.lane.items.push(it);
        if (it.type === 'result') {
          o.lane.state = stateOf(it.p);
          open.delete(a);
        }
        continue;
      }
      const s = settling.get(a);
      if (s && it.type === 'result') {
        s.state = stateOf(it.p);
        settling.delete(a);
      }
    }
    out.push(it);
  }
  for (const b of blocks) {
    for (const lane of b.lanes) {
      lane.files = filesOf(lane.items, cwd);
      lane.latest = latestOf(lane.items);
    }
  }
  return out;
}

/** Whether every lane's turn has ended: the lanes item ends its turn the way a result does. */
export const lanesEnded = (b: LanesItem) => b.lanes.every((l) => l.state !== 'working');

/** The reply items of one lane, for an author line or a step list of its own. */
export const laneReplies = (lane: Lane) => lane.items.filter((i): i is ReplyItem => REPLY.has(i.type));
