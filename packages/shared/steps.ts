// A turn's progress as a few plain steps, the thread's main progress view on desktop web, phone web, the desktop app
// and iOS. The list comes from the agent's own set_steps calls (crates/omni-mcp steps.rs), else from a plan the harness
// keeps (Claude Code's TodoWrite, which Codex plans and Cursor todos arrive as, or its TaskCreate and TaskUpdate), else
// from Omni grouping the turn's calls into phases ("Searching the web"). Hermes and Cursor cloud agents get no local
// MCP servers, so they show phases. Wording stays plain: no tool names, paths or commands. The calls stay one tap away.
// Pure, on top of the transcript fold.
import { isQuestionTool } from './question.ts';
import { str, type Item, type ToolCall } from './transcript-fold.ts';
import { BROWSER_SERVER, connectorFor, type Connector } from './connectors.ts';

/** html_render, as html-render.ts names it. Not imported from there: that module holds the frame's script, and the fold must stay free of browser globals for iOS (tests/transcript-portable.test.ts). */
const isRenderTool = (name: string) => /^mcp__omni[-_]render__html_render$/.test(name);

/** The MCP server with set_steps (apps/server/sandbox.ts). */
export const STEPS_SERVER = 'omni-steps';

/** Harnesses name it `mcp__omni-steps__set_steps`, or with an underscore for the dash (Codex). */
export const isStepsTool = (name: string) => /^mcp__omni[-_]steps__set_steps$/.test(name);

/** Claude Code's task list, the newer TodoWrite: TaskCreate adds one, TaskUpdate moves or renames it. */
const TASK_LIST = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

/** A call that only keeps a plan, not work: it is no action and no phase of its own. */
const isPlanCall = (name: string) => name === 'TodoWrite' || TASK_LIST.has(name);

/** A call that only moves the list, not work: it is no action and no phase of its own. */
const isListCall = (name: string) => isStepsTool(name) || isPlanCall(name);

/** A call that hands work to a crew thread or a helper: what a step's `threads` and its cards come from. */
export const isHandOff = (name: string) => name === 'mcp__omni__delegate' || name === 'mcp__omni__delegate_team' || name === 'Agent' || name === 'Task';

export type StepState = 'done' | 'active' | 'pending' | 'needs' | 'failed' | 'stopped';

/** Each state's status mark (status.ts glyphs), the same on every client. */
export const STEP_GLYPH: Record<StepState, 'done' | 'running' | 'idle' | 'needs' | 'failed' | 'settled'> = {
  done: 'done',
  active: 'running',
  pending: 'idle',
  needs: 'needs',
  failed: 'failed',
  stopped: 'settled',
};

export interface Step {
  /** Stable within a turn, for React keys: the title for a listed step, the phase for a grouped one. */
  key: string;
  title: string;
  state: StepState;
  /** On the active step while the turn runs: what it is doing right now, in plain words. */
  now: string | null;
  /** The outside connector `now` uses ("Using Granola"), for its mark beside the line. Absent otherwise. */
  connector?: Connector | null;
  /** The calls made while it was the step, in order, sub-agents' calls nested under theirs. */
  calls: ToolCall[];
  /** Those calls, sub-agents' own counted. */
  actions: number;
  /** The threads its delegate calls started, in order (a team's lead for a team): they show nested under it. */
  threads: string[];
}

export interface StepsView {
  /** The agent's set_steps, a plan the harness sent, or Omni's grouping of the calls. */
  source: 'agent' | 'plan' | 'phases';
  steps: Step[];
  done: number;
  /** The step it is on, from 1 ("Step 3 of 5"), or 0 with none. */
  at: number;
  /** Every call in the turn, sub-agents' own counted, the list's own calls not. */
  actions: number;
  /** The turn still runs. */
  live: boolean;
}

/**
 * The field the server adds to a running thread it lists, opens or sends on the feed (apps/server/step-line.ts): the
 * step it is on as `stepLine` words it. Absent unless it runs and is on a step, and from an older server.
 */
export interface StepField {
  step?: string;
}

/**
 * A delegated thread's step list in brief, for the delegation card on its parent (desktop web, phone web, the desktop
 * app and iOS): how far along the list it made (set_steps, or its harness's plan) is, the step it is on and what it does
 * now. From its newest turn, so a finished thread keeps how its list ended. Grouped phases are left out: a thread with
 * no list of its own shows none.
 */
export interface StepProgress {
  /** The list's length: the bar's segments. */
  count: number;
  done: number;
  /** The step it is on, or the one its turn ended on (failed, stopped), from 1. 0 with none. */
  at: number;
  /** That step's state. Null with none. */
  state: StepState | null;
  /** That step's title. Null with none. */
  title: string | null;
  /** What it does now, while the step runs. */
  now: string | null;
  /** The turn still runs. */
  live: boolean;
}

/** The field the server adds to a delegated thread on its parent's detail and the feed (apps/server/step-line.ts). */
export interface ProgressField {
  progress?: StepProgress;
}

/** A turn's list in brief (StepProgress), or null for grouped phases or no list. */
export function stepProgress(v: StepsView | null): StepProgress | null {
  if (!v || v.source === 'phases' || !v.steps.length) return null;
  const k = v.steps.findIndex((s) => s.state === 'active' || s.state === 'needs' || s.state === 'failed' || s.state === 'stopped');
  const on = k >= 0 ? v.steps[k] : null;
  return {
    count: v.steps.length,
    done: v.done,
    at: k + 1,
    state: on?.state ?? null,
    title: on?.title ?? null,
    now: v.live && on ? on.now : null,
    live: v.live,
  };
}

/**
 * The brief in one line: "Step 2 of 5 · Design the card" while on a step, "Failed on step 3 of 5 · Run the tests" for
 * a turn that ended on one, else the count ("All 5 steps done", "3 of 5 steps done", "Wrapping up").
 */
export function progressLine(p: StepProgress): string {
  const of = `${p.at} of ${p.count}`;
  if (p.at && p.title) {
    if (p.state === 'failed') return `Failed on step ${of} · ${p.title}`;
    if (p.state === 'stopped') return `Stopped on step ${of} · ${p.title}`;
    return `Step ${of} · ${p.title}`;
  }
  if (p.done === p.count) return p.live ? 'Wrapping up' : p.count === 1 ? 'The step is done' : `All ${p.count} steps done`;
  return `${p.done} of ${stepsLabel(p.count)} done`;
}

/** The bar's ink: amber while a question waits on Ben, muted for a list that ended on a failed or stopped step. */
export const progressInk = (p: StepProgress): 'needs' | 'muted' | null =>
  p.state === 'needs' ? 'needs' : p.state === 'failed' || p.state === 'stopped' ? 'muted' : null;

/** How a turn ended, as the fold's result and error items say. Null: it did not say (it runs, or a newer turn began). */
export type TurnEnd = 'done' | 'failed' | 'stopped' | null;

export interface TurnStepsInput {
  /** The turn still runs. */
  live: boolean;
  /** A question waits on the user's answer: the step it is on needs them. */
  asking?: boolean;
  /** The harness's own status line ("Compacting"), which is what it does now when set. */
  status?: string | null;
}

const count = (c: ToolCall): number => c.children.reduce((n, ch) => n + 1 + count(ch), 0);

const parse = (text: string | undefined): Record<string, unknown> | null => {
  try {
    const v = text ? JSON.parse(text) : null;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

/** The thread a delegate call started, from its answer (apps/mcp/omni.ts): a team's lead for delegate_team. */
function delegatedThread(c: ToolCall): string | null {
  if (!c.result || c.result.is_error || !/^mcp__omni__delegate(_team)?$/.test(c.name)) return null;
  const r = parse(c.result.text);
  const t = c.name === 'mcp__omni__delegate_team' ? (r?.lead as Record<string, unknown> | undefined) : r;
  return typeof t?.thread_id === 'string' ? t.thread_id : null;
}

const threadsOf = (calls: readonly ToolCall[]) => calls.map(delegatedThread).filter((id): id is string => !!id);
const actionsIn = (calls: readonly ToolCall[]) => calls.reduce((n, c) => n + 1 + count(c), 0);

export const actionsLabel = (n: number) => `${n} ${n === 1 ? 'action' : 'actions'}`;

export const stepsLabel = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

// ---------- plain words for a call ----------

/** A call in plain words: the phase it belongs to and what it is doing. */
export interface Plain {
  phase: string;
  title: string;
  now: string;
  /** The outside connector the call reaches, whose mark shows beside `now`. */
  connector?: Connector;
}

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const quoted = (s: string, max = 60) => {
  const one = s.trim().replace(/\s+/g, ' ');
  return `"${one.length > max ? `${one.slice(0, max - 1)}…` : one}"`;
};

/** Search words worth showing: letters, digits and spaces, not a pattern. */
const plainWords = (s: string) => /^[\p{L}\p{N} '.-]{2,60}$/u.test(s.trim());

const sentence = (s: string) => {
  const one = s.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
  return one ? one[0].toUpperCase() + one.slice(1) : '';
};

const FILES = 'Looking through the files';
const CHANGES = 'Making the changes';
const COMMANDS = 'Running commands';
const WEB = 'Searching the web';
const BROWSER = 'Checking the website';
const PAGE = 'Preparing the page';
const READY = 'Getting ready';
const OMNI = 'Checking on the work';
const WORKING = 'Working on it';
const ANSWER = 'Writing the answer';

/**
 * Known connectors by what they hold, so the phase reads "Checking your mail", not "Using Gmail". The line under the
 * step names the app itself ("Now: Using Gmail") with its mark (connectors.ts), as Claude's apps do.
 */
const APPS: [RegExp, string][] = [
  [/mail|outlook|spark/i, 'Checking your mail'],
  [/calendar/i, 'Checking your calendar'],
  [/drive|dropbox/i, 'Looking in your files online'],
  [/docs/i, 'Working on the document'],
  [/slack/i, 'Looking in Slack'],
  [/notion/i, 'Looking in Notion'],
  [/github/i, 'Checking GitHub'],
  [/figma|design/i, 'Looking at the designs'],
  [/shopify/i, 'Checking the store'],
  [/vercel/i, 'Checking the website hosting'],
  [/granola|meetings/i, 'Reading the meeting notes'],
];


function browserNow(tool: string, input: Record<string, unknown>) {
  if (/navigate|open|goto|new_page/i.test(tool)) {
    const where = host(str(input.url));
    return where ? `Opening ${where}` : 'Opening a page';
  }
  if (/click|hover|drag|drop|press|select/i.test(tool)) return 'Clicking through the page';
  if (/type|fill|upload/i.test(tool)) return 'Filling in the page';
  if (/screenshot|snapshot|find|read|console|network/i.test(tool)) return 'Looking at the page';
  if (/wait/i.test(tool)) return 'Waiting for the page';
  return 'Using the browser';
}

/** The Conductor's tools (apps/mcp/omni.ts). */
function omniPlain(tool: string, input: Record<string, unknown>): Plain {
  if (tool === 'delegate' || tool === 'delegate_team') {
    const role = str(input.role);
    return { phase: 'crew', title: 'Handing it to the crew', now: role ? `Handing it to ${role[0].toUpperCase() + role.slice(1)}` : 'Handing it to the crew' };
  }
  if (/^(message_thread|continue_thread|hand_off_thread)$/.test(tool)) return { phase: 'omni', title: OMNI, now: 'Sending a follow-up' };
  if (/thread|crew|question|pull_request|prs/.test(tool)) return { phase: 'omni', title: OMNI, now: 'Checking on the threads' };
  return { phase: 'omni', title: OMNI, now: 'Checking Omni' };
}

/** A call in plain words. `phase` groups calls of one kind into one fallback step. */
export function plainCall(c: Pick<ToolCall, 'name' | 'input'>): Plain {
  const n = c.name;
  const i = c.input;
  const file = base(str(i.file_path) || str(i.notebook_path) || str(i.path));
  switch (n) {
    case 'Read':
    case 'NotebookRead':
      return { phase: 'files', title: FILES, now: file ? `Reading ${quoted(file)}` : 'Reading a file' };
    case 'Grep': {
      const q = str(i.pattern);
      return { phase: 'files', title: FILES, now: plainWords(q) ? `Searching the files for ${quoted(q)}` : 'Searching the files' };
    }
    case 'Glob':
    case 'LS':
      return { phase: 'files', title: FILES, now: 'Finding the right files' };
    case 'Diff':
      return { phase: 'files', title: FILES, now: 'Reading the changes' };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { phase: 'changes', title: CHANGES, now: file ? `Editing ${quoted(file)}` : 'Editing a file' };
    case 'Write':
      return { phase: 'changes', title: CHANGES, now: file ? `Writing ${quoted(file)}` : 'Writing a file' };
    case 'Delete':
      return { phase: 'changes', title: CHANGES, now: file ? `Removing ${quoted(file)}` : 'Removing a file' };
    case 'Bash':
      return { phase: 'commands', title: COMMANDS, now: sentence(str(i.description)) || 'Running a command' };
    case 'BashOutput':
    case 'Monitor':
      return { phase: 'commands', title: COMMANDS, now: 'Checking on a command' };
    case 'KillShell':
    case 'KillBash':
    case 'TaskStop':
      return { phase: 'commands', title: COMMANDS, now: 'Stopping a command' };
    case 'TaskOutput':
      return { phase: 'commands', title: COMMANDS, now: 'Checking on a command' };
    case 'WebSearch': {
      const q = str(i.query);
      return { phase: 'web', title: WEB, now: q ? `Searching the web for ${quoted(q)}` : 'Searching the web' };
    }
    case 'WebFetch': {
      const where = host(str(i.url));
      return { phase: 'web', title: WEB, now: where ? `Reading a page on ${where}` : 'Reading a web page' };
    }
    case 'Task':
    case 'Agent':
      return { phase: 'helper', title: 'Bringing in a helper', now: sentence(str(i.description)) || 'A helper is on part of it' };
    case 'Artifact':
    case 'ArtifactData':
    case 'ArtifactComments':
      return { phase: 'page', title: PAGE, now: 'Publishing the page' };
    case 'ImageGeneration':
      return { phase: 'page', title: 'Making the image', now: 'Making the image' };
    case 'Skill':
      return { phase: 'ready', title: READY, now: 'Reading the instructions' };
    case 'ToolSearch':
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return { phase: 'ready', title: READY, now: 'Getting ready' };
  }
  if (isRenderTool(n)) {
    const title = str(i.title);
    return { phase: 'page', title: PAGE, now: title ? `Building ${quoted(title)}` : 'Building the page' };
  }
  const m = n.match(/^mcp__(.+?)__(.+)$/);
  if (m) {
    const [, server, tool] = m;
    if (BROWSER_SERVER.test(server)) return { phase: 'browser', title: BROWSER, now: browserNow(tool, i) };
    if (server === 'omni') return omniPlain(tool, i);
    if (/^omni[-_]threads$/.test(server)) return { phase: 'omni', title: OMNI, now: 'Reading the thread you pointed to' };
    // message_members: a team thread's lead gives its members their parts (apps/server/runner/team.ts).
    if (/^omni[-_]team$/.test(server)) return { phase: 'omni', title: OMNI, now: 'Giving the members their parts' };
    const app = connectorFor(server);
    if (app) {
      const now = `Using ${app.name === 'Connected app' ? 'a connected app' : app.name}`;
      const outside = app.kind === 'connector' ? { connector: app } : {};
      const known = APPS.find(([re]) => re.test(server));
      if (known) return { phase: `app:${known[1]}`, title: known[1], now, ...outside };
      return { phase: `app:${app.name}`, title: now, now, ...outside };
    }
  }
  return { phase: 'other', title: WORKING, now: WORKING };
}

// ---------- the list ----------

interface Listed {
  titles: string[];
  /** The title to show while each one is active (TodoWrite's activeForm). */
  doing: (string | null)[];
  states: StepState[];
}

const title = (s: string) => {
  const one = s.trim().replace(/\s+/g, ' ');
  return one.length > 90 ? `${one.slice(0, 89)}…` : one;
};

/** A set_steps call's list: the titles, and which one it is on. Null for one that does not read as a list. */
function fromSetSteps(c: ToolCall): Listed | null {
  if (c.result?.is_error) return null;
  const titles = (Array.isArray(c.input.steps) ? c.input.steps : []).map((s) => title(str(s))).filter(Boolean);
  if (!titles.length) return null;
  const raw = Number(c.input.current);
  const current = Number.isFinite(raw) ? Math.max(0, Math.min(titles.length, Math.floor(raw))) : 0;
  return { titles, doing: titles.map(() => null), states: titles.map((_, k) => (k < current ? 'done' : k === current ? 'active' : 'pending')) };
}

const TODO: Record<string, StepState> = { completed: 'done', in_progress: 'active', pending: 'pending' };

/** Reads a plan call into the list it leaves, or null for a call that is not one. */
type Reader = (c: ToolCall) => Listed | null;

/**
 * Claude Code's task list, built up call by call: TaskCreate adds a task, whose number its answer gives ("Task #3
 * created"), TaskUpdate moves, renames or deletes one by that number. A TaskUpdate for a task made in an earlier turn
 * is left out: the turn shows the tasks it made.
 */
function taskReader(): Reader {
  const rows: { id: string; title: string; doing: string | null; state: StepState }[] = [];
  let made = 0;
  return (c) => {
    const i = c.input;
    if (c.name === 'TaskCreate') {
      made++;
      const t = title(str(i.subject) || str(i.title) || str(i.description));
      if (!t || c.result?.is_error) return null;
      const id = /Task #(\w+)/.exec(c.result?.text ?? '')?.[1] ?? String(made);
      rows.push({ id, title: t, doing: title(str(i.activeForm)) || null, state: 'pending' });
    } else if (c.name === 'TaskUpdate') {
      const k = rows.findIndex((r) => r.id === str(i.taskId).replace(/^#/, ''));
      if (k < 0 || c.result?.is_error) return null;
      const status = str(i.status);
      if (status === 'deleted') rows.splice(k, 1);
      else {
        const row = rows[k];
        if (TODO[status]) row.state = TODO[status];
        if (str(i.subject)) row.title = title(str(i.subject));
        if (str(i.activeForm)) row.doing = title(str(i.activeForm));
      }
    } else return null;
    return rows.length ? { titles: rows.map((r) => r.title), doing: rows.map((r) => r.doing), states: rows.map((r) => r.state) } : null;
  };
}

/** A harness's plan: TodoWrite's whole list each call, or the task list built up call by call. */
function planReader(): Reader {
  const tasks = taskReader();
  return (c) => (c.name === 'TodoWrite' ? fromTodos(c) : TASK_LIST.has(c.name) ? tasks(c) : null);
}

function fromTodos(c: ToolCall): Listed | null {
  const todos = (Array.isArray(c.input.todos) ? c.input.todos : []) as { content?: unknown; activeForm?: unknown; status?: unknown }[];
  const rows = todos.map((t) => ({ title: title(str(t.content)), doing: title(str(t.activeForm)) || null, state: TODO[str(t.status)] ?? 'pending' })).filter((t) => t.title);
  if (!rows.length) return null;
  return { titles: rows.map((r) => r.title), doing: rows.map((r) => r.doing), states: rows.map((r) => r.state) };
}

/** The step a call made now counts toward: the active one, else the next one not done, else the last. */
function stepNow(l: Listed) {
  const active = l.states.indexOf('active');
  if (active >= 0) return active;
  const next = l.states.findIndex((s) => s !== 'done');
  return next >= 0 ? next : l.titles.length - 1;
}

/** The newest call still waiting on its result, a sub-agent's own included: what the turn is doing now. */
function openCall(calls: readonly ToolCall[]) {
  let open: ToolCall | undefined;
  const walk = (cs: readonly ToolCall[]) => {
    for (const c of cs) {
      if (isListCall(c.name)) continue;
      if (!c.result) open = c;
      walk(c.children);
    }
  };
  walk(calls);
  return open;
}

/**
 * One turn's steps, from its items (a TurnView's `items`, or `turnsOf` below). Null for a finished turn that made no
 * calls: a plain answer needs no steps.
 */
export function turnSteps(items: readonly Item[], { live, asking = false, status = null }: TurnStepsInput): StepsView | null {
  const calls: ToolCall[] = [];
  let end: TurnEnd = null;
  let text = false;
  /** The newest item is text: it writes, not acts. */
  let writing = false;
  for (const it of items) {
    if (it.type === 'tools') {
      calls.push(...it.calls);
      writing = false;
    } else if (it.type === 'text') {
      text = true;
      writing = true;
    } else if (it.type === 'result') end = it.p.stopped ? 'stopped' : it.p.ok ? 'done' : 'failed';
    else if (it.type === 'error') end = end ?? 'failed';
    else if (it.type === 'user' || it.type === 'question') writing = false;
  }
  const running = live && !end;
  const work = calls.filter((c) => !isListCall(c.name) && !isQuestionTool(c.name));
  const agent = calls.some((c) => isStepsTool(c.name));
  const planned = !agent && calls.some((c) => isPlanCall(c.name));
  if (!running && !work.length && !agent && !planned) return null;

  const open = openCall(calls);
  const openPlain = open ? plainCall(open) : null;
  const nowLine = status || (openPlain ? openPlain.now : writing ? ANSWER : 'Thinking it over');

  let steps: Step[];
  let source: StepsView['source'];
  if (agent || planned) {
    source = agent ? 'agent' : 'plan';
    const read: Reader = agent ? (c) => (isStepsTool(c.name) ? fromSetSteps(c) : null) : planReader();
    let list: Listed | null = null;
    // Each call goes to the step that was on when it ran, by title so a list that grew or shrank keeps it.
    const placed: { c: ToolCall; title: string; index: number }[] = [];
    for (const c of calls) {
      const next = read(c);
      if (next) {
        list = next;
        continue;
      }
      if (isListCall(c.name) || isQuestionTool(c.name)) continue;
      const k = list ? stepNow(list) : 0;
      placed.push({ c, title: list?.titles[k]?.toLowerCase() ?? '', index: k });
    }
    if (!list) return null;
    const final = list;
    const lower = final.titles.map((t) => t.toLowerCase());
    const byStep = final.titles.map(() => [] as ToolCall[]);
    for (const p of placed) {
      const k = lower.indexOf(p.title);
      byStep[k >= 0 ? k : Math.min(p.index, byStep.length - 1)].push(p.c);
    }
    steps = final.titles.map((t, k) => ({
      key: `${k}:${lower[k]}`,
      title: final.states[k] === 'active' && final.doing[k] ? final.doing[k]! : t,
      state: final.states[k],
      now: null,
      calls: byStep[k],
      actions: actionsIn(byStep[k]),
      threads: threadsOf(byStep[k]),
    }));
  } else {
    source = 'phases';
    const phases = new Map<string, Step>();
    for (const c of work) {
      const p = plainCall(c);
      const step = phases.get(p.phase) ?? { key: p.phase, title: p.title, state: 'done' as StepState, now: null, calls: [], actions: 0, threads: [] };
      step.calls.push(c);
      step.actions += 1 + count(c);
      const id = delegatedThread(c);
      if (id) step.threads.push(id);
      phases.set(p.phase, step);
    }
    steps = [...phases.values()];
    // The floor, on every turn: it works on it, then writes the answer.
    if (!steps.length) steps.push({ key: '#working', title: WORKING, state: 'done', now: null, calls: [], actions: 0, threads: [] });
    if (running || text) steps.push({ key: '#answer', title: ANSWER, state: running ? 'pending' : 'done', now: null, calls: [], actions: 0, threads: [] });
    if (running) {
      const answer = steps[steps.length - 1];
      const latest = work[work.length - 1];
      // Text after the last call is it writing; else the phase of the call it made last, else it is just starting.
      const on = writing ? answer : latest ? (steps.find((s) => s.key === plainCall(latest).phase) ?? answer) : steps[0];
      on.state = 'active';
      // Only the answer is still to come; every phase before the one it is on has had its turn.
      for (const s of steps) if (s !== on && s !== answer) s.state = 'done';
    }
  }

  if (running) {
    const on = steps.find((s) => s.state === 'active');
    if (on) {
      on.now = on.key === '#answer' && !open && !status ? null : nowLine;
      if (on.now && !status && openPlain?.connector) on.connector = openPlain.connector;
      if (asking) on.state = 'needs';
    }
  } else {
    // A finished turn: the step it was on ends as the turn did. One that ran on when a newer turn began just stopped.
    const how: StepState = end === 'done' ? 'done' : end === 'failed' ? 'failed' : 'stopped';
    const on = steps.findLast((s) => s.state === 'active') ?? (how !== 'done' && source === 'phases' ? steps[steps.length - 1] : undefined);
    if (on) on.state = how;
    for (const s of steps) if (s.state === 'active') s.state = how;
  }

  const at = steps.findIndex((s) => s.state === 'active' || s.state === 'needs') + 1;
  return {
    source,
    steps,
    done: steps.filter((s) => s.state === 'done').length,
    at,
    actions: actionsIn(work),
    live: running,
  };
}

/**
 * The fold's items cut into turns by threadView's rule: a message or report after a turn ended starts the next one,
 * one sent while it ran was steered into it. The desktop transcript shows items flat, so it cuts them here.
 */
export function turnsOf(items: readonly Item[]): Item[][] {
  const turns: Item[][] = [];
  let cur: Item[] | null = null;
  let ended = false;
  for (const it of items) {
    if ((it.type === 'user' || it.type === 'report') && (!cur || ended)) {
      cur = [];
      turns.push(cur);
      ended = false;
    } else if (!cur) {
      cur = [];
      turns.push(cur);
    }
    cur.push(it);
    if (it.type === 'result' || it.type === 'error') ended = true;
  }
  return turns;
}

/** The header of a list: "Step 3 of 5" for a list the agent or harness made, the state for grouped phases. */
export function stepsHeader(v: StepsView): string {
  if (v.live) {
    if (v.source !== 'phases' && v.at) return `Step ${v.at} of ${v.steps.length}`;
    if (v.source !== 'phases') return v.done === v.steps.length ? 'Wrapping up' : 'Working';
    return 'Working';
  }
  const n = v.steps.length;
  const steps = stepsLabel(n);
  if (v.source !== 'phases' && v.done < n) return `${v.done} of ${steps}`;
  return steps;
}

/**
 * Whether a turn's steps are worth a card: a list the agent or harness made, or calls to group. A turn that has only
 * the floor (Working on it, Writing the answer) leaves it to the thinking line and the Inbox's step line.
 */
export const showsSteps = (v: StepsView | null): v is StepsView => !!v && (v.source !== 'phases' || v.actions > 0);

/**
 * A running turn's step in one line, for an Inbox card, a phone row or a notification: "Step 3 of 5 · Compare prices"
 * for a list the agent or harness made, the phase for grouped calls ("Searching the web"). Null when it has no step on.
 */
export function stepLine(v: StepsView | null): string | null {
  if (!v?.live) return null;
  const on = v.steps.find((s) => s.state === 'active' || s.state === 'needs');
  if (!on) return v.source !== 'phases' && v.done === v.steps.length ? 'Wrapping up' : null;
  return v.source !== 'phases' ? `Step ${v.at} of ${v.steps.length} · ${on.title}` : on.title;
}
