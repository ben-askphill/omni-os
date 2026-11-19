// A thread folded per turn: what Ben asked, what came back, what it cost and what it made. The phone's thread screen
// and the iOS app draw it. Pure, on top of the transcript fold (transcript-fold.ts), so it reads the same events the
// desktop transcript does.
import type { AskP } from './ask.ts';
import type { ThreadQuestion } from './question.ts';
import type { Clipped, Span } from './history.ts';
import { cloudStatus } from './cloud-agent.ts';
import { connectorOf, isOutsideConnector, type Connector } from './connectors.ts';
import { turnSteps, type StepsView } from './steps.ts';
import { buildItems, isAsking, toolLabel, toolSummary, type CloudAgentP, type Item, type ReportP, type ResultP, type SwitchItem, type ToolCall, type TranscriptEvent, type UserP } from './transcript-fold.ts';

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
}

/** What a thread view reads of the thread itself. */
export interface TurnThread {
  status: string;
  cwd?: string | null;
  harness: string;
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
  /** The harness the turn ran on, which a switch can change from one turn to the next. */
  harness: string;
}

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

function endOf(t: Pick<TurnView, 'result' | 'error'>): TurnStatus | null {
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
  const { items } = buildItems(events, spans);
  const turns: TurnView<A, C>[] = [];
  // Until the first switch, the thread ran where that switch moved it from.
  let harness = items.find((it): it is SwitchItem => it.type === 'switch')?.p.from.harness ?? thread.harness;
  const start = (key: number, at: string): TurnView<A, C> => {
    const t: TurnView<A, C> = { key, at, prompts: [], steps: 0, progress: null, failed: 0, texts: [], prose: null, proseKey: null, proseClipped: null, reports: [], questions: [], artifacts: [], children: [], asks: [], answers: {}, result: null, error: null, cloud: null, status: 'done', items: [], switches: [], harness };
    turns.push(t);
    return t;
  };
  let cur: TurnView<A, C> | null = null;
  const shown: ReportP[] = [];
  for (const it of items) {
    // A report that started no turn belongs to the turn that delegated its thread, placed below.
    if (it.type === 'report' && it.p.shown) {
      shown.push(it.p);
      continue;
    }
    // A message or report after a turn ended starts the next one; one sent while it ran was steered into it.
    if (it.type === 'user' || it.type === 'report') {
      if (!cur || endOf(cur)) cur = start(it.key, it.at);
      if (it.type === 'user') cur.prompts.push({ ...it.p, key: it.key, ...(it.clipped && { clipped: it.clipped }) });
      else cur.reports.push(it.p);
    } else if (it.type === 'text') {
      cur ??= start(it.key, it.at);
      cur.texts.push(it.p.text);
      cur.proseKey = it.key;
      cur.proseClipped = it.clipped ? { key: it.key, clipped: it.clipped } : null;
    } else if (it.type === 'tools') {
      const turn: TurnView<A, C> = (cur ??= start(it.key, it.calls[0]?.at ?? ''));
      turn.steps += it.total;
      walk(it.calls, (c) => {
        if (c.result?.is_error) turn.failed++;
      });
    } else if (it.type === 'question') {
      cur ??= start(it.key, it.at);
      cur.questions.push(it.q);
    } else if (it.type === 'ask') {
      cur ??= start(it.key, it.at);
      cur.asks.push(it.p);
    } else if (it.type === 'result') {
      if (cur) cur.result = it.p;
    } else if (it.type === 'error') {
      cur ??= start(it.key, '');
      cur.error = it.p.text;
    } else if (it.type === 'cloud') {
      cur ??= start(it.key, '');
      cur.cloud = it.p;
    } else if (it.type === 'switch') {
      // A thread always starts with a message, so a switch has a turn before it.
      cur?.switches.push(it);
      harness = it.p.to.harness;
      continue;
    }
    cur?.items.push(it);
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
    for (const c of children) if (c.source !== 'team') turnAt(c.created_at).children.push(c);
    // On the card of its thread; one whose delegating turn is not loaded shows as a report on the newest turn.
    for (const r of shown) {
      const t = turns.find((t) => t.children.some((c) => c.id === r.thread_id)) ?? turns[turns.length - 1];
      if (t.children.some((c) => c.id === r.thread_id)) t.answers[r.thread_id] = r;
      else t.reports.push(r);
    }
  }

  turns.forEach((t, i) => {
    t.prose = t.texts.length ? t.texts[t.texts.length - 1] : null;
    const last = i === turns.length - 1;
    t.status = endOf(t) ?? (last ? (LIVE[thread.status] ?? 'done') : 'stopped');
  });

  const asking = isAsking(events);
  const latest = turns[turns.length - 1];
  const running = thread.status === 'running' && !!latest && latest.status === 'running';
  turns.forEach((t) => {
    const live = running && t === latest;
    t.progress = turnSteps(t.items, { live, asking: live && asking });
  });
  if (!running) return { turns, now: null, asking };
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
    now: asking ? null : open ? nowDoing(open, thread.cwd) : latest.cloud ? { verb: `Cursor cloud agent: ${cloudStatus(latest.cloud.status).label.toLowerCase()}`, target: '' } : { verb: 'Thinking', target: '' },
    asking,
  };
}
