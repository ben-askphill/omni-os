// The phone's thread screen, folded per turn: what Ben asked, what came back, what it cost and what it made. Pure, on
// top of the transcript fold (transcript/fold.ts), so it reads the same events the desktop transcript does.
import type { Artifact, Thread } from '../api.ts';
import { toDate } from '../format.ts';
import { buildItems, toolLabel, toolSummary, type Item, type ReportP, type ResultP, type Todo, type ToolCall, type TranscriptEvent, type UserP } from '../transcript/fold.ts';

export type TurnStatus = 'running' | 'queued' | 'done' | 'failed' | 'stopped';

export interface TurnView {
  key: number;
  at: string;
  /** Ben's message that started it, then any he steered in while it ran. Empty when a crew report started it. */
  prompts: UserP[];
  /** Tool calls, sub-agents' own calls included. */
  steps: number;
  failed: number;
  /** Every assistant text in order. */
  texts: string[];
  /** The turn's answer: its last text. */
  prose: string | null;
  reports: ReportP[];
  /** Files the turn wrote last, so each file shows once, with the turn that made its current version. */
  artifacts: Artifact[];
  /** Threads delegated during the turn. */
  children: Thread[];
  result: ResultP | null;
  error: string | null;
  status: TurnStatus;
  /** The turn's rows, for the Steps screen. */
  items: Item[];
}

export interface PlanView {
  todos: Todo[];
  done: number;
}

/** What a running thread is doing now: "Editing" `snippets/shipping-rates.liquid`. */
export interface NowDoing {
  verb: string;
  target: string;
}

export interface ThreadView {
  turns: TurnView[];
  /** The latest TodoWrite of the latest turn, while it runs. */
  plan: PlanView | null;
  now: NowDoing | null;
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
  return { verb: VERB[call.name] ?? `Using ${toolLabel(call.name)}`, target: call.name === 'TodoWrite' ? '' : toolSummary(call, cwd) };
}

const walk = (calls: ToolCall[], fn: (c: ToolCall) => void) => {
  for (const c of calls) {
    fn(c);
    walk(c.children, fn);
  }
};

const time = (iso: string) => toDate(iso).getTime();

function endOf(t: TurnView): TurnStatus | null {
  if (t.result) return t.result.stopped ? 'stopped' : t.result.ok ? 'done' : 'failed';
  return t.error ? 'failed' : null;
}

/** The thread's status as its newest turn's. */
const LIVE: Record<string, TurnStatus> = { running: 'running', queued: 'queued', failed: 'failed', stopped: 'stopped', done: 'done' };

export function threadView({
  events,
  thread,
  artifacts,
  children,
}: {
  events: TranscriptEvent[];
  thread: Pick<Thread, 'status' | 'cwd'>;
  artifacts: Artifact[];
  children: Thread[];
}): ThreadView {
  const { items, plan } = buildItems(events);
  const turns: TurnView[] = [];
  const start = (key: number, at: string): TurnView => {
    const t: TurnView = { key, at, prompts: [], steps: 0, failed: 0, texts: [], prose: null, reports: [], artifacts: [], children: [], result: null, error: null, status: 'done', items: [] };
    turns.push(t);
    return t;
  };
  let cur: TurnView | null = null;
  for (const it of items) {
    // A message or report after a turn ended starts the next one; one sent while it ran was steered into it.
    if (it.type === 'user' || it.type === 'report') {
      if (!cur || endOf(cur)) cur = start(it.key, it.at);
      if (it.type === 'user') cur.prompts.push(it.p);
      else cur.reports.push(it.p);
    } else if (it.type === 'text') {
      cur ??= start(it.key, it.at);
      cur.texts.push(it.p.text);
    } else if (it.type === 'tools') {
      const turn: TurnView = (cur ??= start(it.key, it.calls[0]?.at ?? ''));
      turn.steps += it.total;
      walk(it.calls, (c) => {
        if (c.result?.is_error) turn.failed++;
      });
    } else if (it.type === 'result') {
      if (cur) cur.result = it.p;
    } else if (it.type === 'error') {
      cur ??= start(it.key, '');
      cur.error = it.p.text;
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
  }

  turns.forEach((t, i) => {
    t.prose = t.texts.length ? t.texts[t.texts.length - 1] : null;
    const last = i === turns.length - 1;
    t.status = endOf(t) ?? (last ? (LIVE[thread.status] ?? 'done') : 'stopped');
  });

  const latest = turns[turns.length - 1];
  const running = thread.status === 'running' && !!latest && latest.status === 'running';
  if (!running) return { turns, plan: null, now: null };
  // The newest call still waiting on its result is what it is doing; with none, it is between calls.
  let open: ToolCall | undefined;
  for (const it of latest.items) {
    if (it.type !== 'tools') continue;
    walk(it.calls, (c) => {
      if (!c.result) open = c;
    });
  }
  const planned = plan && latest.items.some((it) => it.type === 'tools' && it.key === plan.after) ? plan.todos : null;
  return {
    turns,
    plan: planned && { todos: planned, done: planned.filter((x) => x.status === 'completed').length },
    now: open ? nowDoing(open, thread.cwd) : { verb: 'Thinking', target: '' },
  };
}
