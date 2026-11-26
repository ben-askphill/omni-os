// A thread folded per turn: what Ben asked, what came back, what it cost and what it made. The phone's thread screen
// and the iOS app draw it. Pure, on top of the transcript fold (transcript-fold.ts), so it reads the same events the
// desktop transcript does.
import type { AskP } from './ask.ts';
import type { ThreadQuestion } from './question.ts';
import type { Clipped, Span } from './history.ts';
import { cloudStatus } from './cloud-agent.ts';
import { connectorOf, isOutsideConnector, type Connector } from './connectors.ts';
import { turnSteps, type StepsView } from './steps.ts';
import { authorOf, buildItems, cardAnswer, isAsking, isReply, seatedDelegationsAt, toolLabel, toolSummary, type CloudAgentP, type Item, type ReportP, type ResultP, type SwitchItem, type ToolCall, type TranscriptEvent, type UserP } from './transcript-fold.ts';
import { laneFold, type LaneState } from './lanes.ts';
import type { Collision } from './collisions.ts';
import type { SeatedDelegation, ThreadMember } from './members.ts';

export type TurnStatus = 'running' | 'queued' | 'done' | 'failed' | 'stopped';

/** A message of Ben's in a turn, with its row: one that came clipped offers its whole text. */
export type Prompt = UserP & { key: number; clipped?: Clipped };

/** What a turn reads of a file the thread made: when it last changed. A client passes its own richer type and gets it back. */
export interface TurnArtifact {
  updated_at: string;
}

/** What a turn reads of a thread this one delegated to: when it started, and whether it is a team member. */
export interface TurnChild {
  id?: string;
  created_at: string;
  source?: string | null;
  seated_delegation?: SeatedDelegation;
}

/** What a thread view reads of the thread itself. */
export interface TurnThread {
  status: string;
  cwd?: string | null;
  harness: string;
  /** The agent the thread runs as, its lead: rows from before Omni recorded their author read as its. */
  role?: string | null;
  members?: readonly Pick<ThreadMember, 'agent' | 'lead' | 'status'>[];
}

export interface TurnView<A extends TurnArtifact = TurnArtifact, C extends TurnChild = TurnChild> {
  key: number;
  at: string;
  /** Ben's message that started it, then any he steered in while it ran. Empty when a crew report started it. */
  prompts: Prompt[];
  /** Tool calls, sub-agents' own calls included: the turn's actions. */
  steps: number;
  /** The turn's plain steps (steps.ts): the agent's list, the harness's plan or the phases of its calls. Null for a plain answer. */
  progress: StepsView | null;
  failed: number;
  /** Every assistant text in order. */
  texts: string[];
  /** The turn's answer: its last text. */
  prose: string | null;
  /** The answer's row: the find bar's match in it is drawn there. Null with no answer. */
  proseKey?: number | null;
  /** The answer's row, when it came clipped. */
  proseClipped: { key: number; clipped: Clipped } | null;
  reports: ReportP[];
  /** Questions the agent asked Ben during the turn, each shown as its card. */
  questions: ThreadQuestion[];
  /** Files the turn wrote last, so each file shows once, with the turn that made its current version. */
  artifacts: A[];
  /** Threads delegated during the turn. */
  children: C[];
  /** Asks Ben sent from this thread during the turn (ask.ts): each Ask's thread is among `children`. */
  asks: AskP[];
  /** Reports shown in place (ReportP `shown`) from this turn's children, by the child's id: each shows on its card. */
  answers: Record<string, ReportP>;
  result: ResultP | null;
  error: string | null;
  /** The Cursor cloud agent run this turn launched or followed up, as it stands now. */
  cloud: CloudAgentP | null;
  status: TurnStatus;
  /** The turn's rows, for the Steps screen. */
  items: Item[];
  /** Run switches Ben made after the turn ended, shown under it. */
  switches: SwitchItem[];
  /** Agents seated in the thread or removed from it after the turn's reply (ADR 0019), shown under it. */
  members: Extract<Item, { type: 'member' }>[];
  /** The harness the turn ran on, which a switch can change from one turn to the next. */
  harness: string;
  /** The agent that answered: the author of its first reply. Null when no agent wrote it (a thread with no agent). */
  author: string | null;
  /**
   * A message several agents answered (ADR 0019): a turn per agent, one per tab on the phone, with the collision flags
   * raised while they ran and each agent's changed files. The turn ends once every lane has.
   */
  lanes?: { turns: TurnView<A, C>[]; flags: Collision[]; files: Record<string, string[]>; latest: Record<string, string | null>; stacked: boolean } | null;
  /** Collision flags raised during the turn outside its lanes. */
  flags?: Collision[];
  /** The merge-risk gate's ratings of the thread's PR written after the turn's reply (merge-risk.ts), shown under it. */
  risks?: Extract<Item, { type: 'merge_risk' }>[];
}

const LANE_STATUS: Record<LaneState, TurnStatus> = { working: 'running', done: 'done', failed: 'failed', stopped: 'stopped' };

/** What a running thread is doing now: "Editing" `snippets/shipping-rates.liquid`. */
export interface NowDoing {
  verb: string;
  target: string;
  /** The outside connector it uses, for its mark. */
  connector?: Connector;
}

export interface ThreadView<A extends TurnArtifact = TurnArtifact, C extends TurnChild = TurnChild> {
  turns: TurnView<A, C>[];
  /** Null while it waits on Ben's answer to a question: it is not doing anything. */
  now: NowDoing | null;
  /** A question waits on Ben's answer. */
  asking: boolean;
}

const VERB: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  NotebookEdit: 'Editing',
  Write: 'Writing',
  Bash: 'Running',
  BashOutput: 'Reading the output of',
  Grep: 'Searching for',
  Glob: 'Finding',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web for',
  TodoWrite: 'Updating the plan',
  Task: 'Running a sub-agent:',
  Agent: 'Running a sub-agent:',
  Skill: 'Using the skill',
  mcp__omni__delegate: 'Delegating',
  mcp__omni__delegate_team: 'Delegating to a team',
};

export function nowDoing(call: Pick<ToolCall, 'name' | 'input'>, cwd?: string | null): NowDoing {
  const target = call.name === 'TodoWrite' ? '' : toolSummary(call, cwd);
  if (VERB[call.name]) return { verb: VERB[call.name], target };
  // An outside connector by its own name and mark: "Using Granola", not "Using claude_ai_Granola · search_meetings".
  const app = connectorOf(call.name);
  if (isOutsideConnector(app)) return { verb: `Using ${app.name}`, target, connector: app };
  return { verb: `Using ${toolLabel(call.name)}`, target };
}

const walk = (calls: ToolCall[], fn: (c: ToolCall) => void) => {
  for (const c of calls) {
    fn(c);
    walk(c.children, fn);
  }
};

const time = (iso: string) => new Date(iso).getTime();

function endOf(t: Pick<TurnView, 'result' | 'error' | 'lanes'>): TurnStatus | null {
  // A turn in lanes ends once every lane has: Done when one finished, else how they all ended.
  if (t.lanes?.turns.length) {
    const ends = t.lanes.turns.map((l) => l.status);
    if (ends.some((x) => x === 'running' || x === 'queued')) return null;
    return ends.includes('done') ? 'done' : ends.every((x) => x === 'stopped') ? 'stopped' : 'failed';
  }
  if (t.result) return t.result.stopped ? 'stopped' : t.result.ok ? 'done' : 'failed';
  return t.error ? 'failed' : null;
}

/** The thread's status as its newest turn's. */
const LIVE: Record<string, TurnStatus> = { running: 'running', queued: 'queued', failed: 'failed', stopped: 'stopped', done: 'done' };

export function threadView<A extends TurnArtifact, C extends TurnChild>({
  events,
  spans,
  thread,
  artifacts,
  children,
}: {
  events: TranscriptEvent[];
  /** The spans of a bounded history (`History.spans`): only their turns show. */
  spans?: readonly Span[];
  thread: TurnThread;
  artifacts: A[];
  children: C[];
}): ThreadView<A, C> {
  const { items: all } = buildItems(events, spans);
  // A message several agents answered gathers their replies into lanes (lanes.ts): each becomes a turn of its own.
  const flow = laneFold(all, { lead: thread.role, cwd: thread.cwd });
  const turns: TurnView<A, C>[] = [];
  const laneTurns: TurnView<A, C>[] = [];
  // Until the first switch, the thread ran where that switch moved it from.
  let harness = all.find((it): it is SwitchItem => it.type === 'switch')?.p.from.harness ?? thread.harness;
  const start = (key: number, at: string): TurnView<A, C> => {
    const t: TurnView<A, C> = { key, at, prompts: [], steps: 0, progress: null, failed: 0, texts: [], prose: null, proseKey: null, proseClipped: null, reports: [], questions: [], artifacts: [], children: [], asks: [], answers: {}, result: null, error: null, cloud: null, status: 'done', items: [], switches: [], members: [], harness, author: null };
    turns.push(t);
    return t;
  };
  let cur: TurnView<A, C> | null = null;
  const lead = thread.role ?? '';
  const byAgent = new Map<string, TurnView<A, C>>();
  const promptTurn = (agent: string, key: number, at: string) => {
    const previous = byAgent.get(agent);
    const turn = previous && !endOf(previous) && !previous.lanes ? previous : start(key, at);
    byAgent.set(agent, turn);
    return turn;
  };
  const shown: ReportP[] = [];
  /** One lane's replies as a turn: its own steps, answer, result and status. */
  const laneTurn = (agent: string, state: LaneState, items: Item[], at: string): TurnView<A, C> => {
    const t: TurnView<A, C> = { key: items[0]?.key ?? 0, at, prompts: [], steps: 0, progress: null, failed: 0, texts: [], prose: null, proseKey: null, proseClipped: null, reports: [], questions: [], artifacts: [], children: [], asks: [], answers: {}, result: null, error: null, cloud: null, status: LANE_STATUS[state], items, switches: [], members: [], harness, author: agent };
    for (const it of items) {
      if (it.type === 'text') {
        t.texts.push(it.p.text);
        t.proseKey = it.key;
        t.proseClipped = it.clipped ? { key: it.key, clipped: it.clipped } : null;
      } else if (it.type === 'tools') {
        t.steps += it.total;
        walk(it.calls, (c) => {
          if (c.result?.is_error) t.failed++;
        });
      } else if (it.type === 'question') t.questions.push(it.q);
      else if (it.type === 'result') t.result = it.p;
      else if (it.type === 'error') t.error = it.p.text;
      else if (it.type === 'cloud') t.cloud = it.p;
    }
    t.prose = t.texts.at(-1) ?? null;
    laneTurns.push(t);
    return t;
  };
  for (const it of flow) {
    if (it.type === 'lanes') {
      cur ??= start(it.key, '');
      cur.lanes = {
        turns: it.lanes.map((l) => laneTurn(l.agent, l.state, l.items, cur!.at)),
        flags: it.flags,
        files: Object.fromEntries(it.lanes.map((l) => [l.agent, l.files])),
        latest: Object.fromEntries(it.lanes.map((l) => [l.agent, l.latest])),
        stacked: it.stacked,
      };
      continue;
    }
    if (it.type === 'collision') {
      cur ??= start(it.key, it.at);
      (cur.flags ??= []).push(it.c);
      continue;
    }
    if (it.type === 'merge_risk') {
      cur ??= start(it.key, it.at);
      (cur.risks ??= []).push(it);
      continue;
    }
    // A report that started no turn belongs to the turn that delegated its thread, placed below.
    if (it.type === 'report' && it.p.shown) {
      shown.push(it.p);
      continue;
    }
    if (it.type === 'switch') {
      cur?.switches.push(it);
      harness = it.p.to.harness;
      continue;
    }
    if (it.type === 'member') {
      cur?.members.push(it);
      continue;
    }
    if (it.type === 'user') {
      const to = it.p.to ?? [];
      if (it.p.source === 'lead') {
        // The lead's messages to its team and their lanes belong to its planning turn.
        cur = promptTurn(it.agent ?? lead, it.key, it.at);
      } else if (to.length > 1) {
        cur = start(it.key, it.at);
        for (const agent of to) byAgent.delete(agent);
      } else {
        cur = promptTurn(to[0] ?? lead, it.key, it.at);
      }
      cur.prompts.push({ ...it.p, key: it.key, ...(it.clipped && { clipped: it.clipped }) });
    } else if (it.type === 'report') {
      cur = promptTurn(lead, it.key, it.at);
      cur.reports.push(it.p);
    } else if (it.type === 'ask') {
      cur ??= start(it.key, it.at);
    }

    let target: TurnView<A, C> | null = cur;
    if (isReply(it) || it.type === 'result' || it.type === 'error') {
      const agent = it.agent ?? lead;
      target = byAgent.get(agent) ?? null;
      // Older rows can carry an author even though the prompt had no explicit recipient.
      if (!target && cur && !cur.author && !cur.lanes && !cur.prompts.at(-1)?.to?.length) target = cur;
      if (!target && it.type !== 'result') {
        const at = 'at' in it ? it.at : it.type === 'tools' ? it.calls[0]?.at : '';
        target = start(it.key, at ?? '');
        cur ??= target;
      }
      if (target) byAgent.set(agent, target);
    }
    if (!target) continue;
    if (it.type === 'text') {
      target.texts.push(it.p.text);
      target.proseKey = it.key;
      target.proseClipped = it.clipped ? { key: it.key, clipped: it.clipped } : null;
    } else if (it.type === 'tools') {
      const turn = target;
      turn.steps += it.total;
      walk(it.calls, (c) => {
        if (c.result?.is_error) turn.failed++;
      });
    } else if (it.type === 'question') {
      target.questions.push(it.q);
    } else if (it.type === 'ask') {
      target.asks.push(it.p);
    } else if (it.type === 'result') {
      target.result = it.p;
    } else if (it.type === 'error') {
      target.error = it.p.text;
    } else if (it.type === 'cloud') {
      target.cloud = it.p;
    }
    if (!target.author && isReply(it)) target.author = authorOf(it, thread.role);
    target.items.push(it);
  }

  const starts = turns.map((t) => (t.at ? time(t.at) : -Infinity));
  const turnAt = (iso: string) => {
    const at = time(iso);
    let i = 0;
    for (let k = 0; k < starts.length; k++) if (starts[k] <= at) i = k;
    return turns[i];
  };
  if (turns.length) {
    for (const a of artifacts) turnAt(a.updated_at).artifacts.push(a);
    // Team members show under their lead, not as delegations of their own.
    for (const c of children) if (c.source !== 'team' && !c.seated_delegation) turnAt(c.created_at).children.push(c);
    for (const [key, seated] of seatedDelegationsAt(children, all, events, spans)) {
      for (const c of seated) {
        const turn = laneTurns.find((t) => t.items.some((it) => it.key === key)) ??
          turns.find((t) => t.items.some((it) => it.key === key) || t.members.some((it) => it.key === key)) ??
          turnAt(c.created_at);
        const lane = turn.lanes?.turns.find((t) => t.author === c.seated_delegation?.agent);
        (lane ?? turn).children.push(c);
      }
    }
    // On the card of its thread; one whose delegating turn is not loaded shows as a report on the newest turn.
    for (const r of shown) {
      const t = turns.find((t) => t.children.some((c) => c.id === r.thread_id)) ??
        laneTurns.find((t) => t.children.some((c) => c.id === r.thread_id)) ?? turns[turns.length - 1];
      if (t.children.some((c) => c.id === r.thread_id)) t.answers[r.thread_id] = cardAnswer(t.answers[r.thread_id], r);
      else t.reports.push(r);
    }
  }

  const statuses = new Map([[lead, thread.status], ...(thread.members ?? []).filter((m) => !m.lead).map((m): [string, string] => [m.agent, m.status])]);
  const latestStatuses = new Map([...byAgent].map(([a, t]) => [t, LIVE[statuses.get(a) ?? '']]));
  turns.forEach((t, i) => {
    t.prose = t.texts.length ? t.texts[t.texts.length - 1] : null;
    const last = i === turns.length - 1;
    t.status = endOf(t) ?? latestStatuses.get(t) ?? (last ? (LIVE[thread.status] ?? 'done') : 'stopped');
  });

  const asking = isAsking(events);
  const latest = turns.findLast((t) => t.status === 'running' && !t.lanes);
  turns.forEach((t) => {
    const live = t.status === 'running' && !t.lanes;
    t.progress = turnSteps(t.items, { live, asking: live && t.questions.some((q) => q.state === 'pending') });
  });
  for (const t of laneTurns) t.progress = turnSteps(t.items, { live: t.status === 'running' });
  if (!latest) return { turns, now: null, asking };
  // The newest call still waiting on its result is what it is doing; with none, it is between calls.
  let open: ToolCall | undefined;
  for (const it of latest.items) {
    if (it.type !== 'tools') continue;
    walk(it.calls, (c) => {
      if (!c.result) open = c;
    });
  }
  return {
    turns,
    // A cloud agent works on Cursor's machines: its run's status is all there is to say.
    now: asking ? null : open ? nowDoing(open, thread.cwd) : latest.cloud ? { verb: `Cursor Cloud: ${cloudStatus(latest.cloud.status).label.toLowerCase()}`, target: '' } : { verb: 'Thinking', target: '' },
    asking,
  };
}
