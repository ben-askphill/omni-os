// Quick asks: a question answered in place, in a thread flagged `quick` that has no charter, worktree, folder or task
// id and stays out of every list but Recent asks. It turns into a task thread, with the answer carried over, when the
// work has to write, run or browse, or when Ben asks for one. Pure, so the server, the Web UI and the iOS app share
// the rules: the agent's TASK line, the task's first message and the keys.

/** How long a quick ask stays under Recent asks. */
export const RECENT_ASKS_DAYS = 7;

/** The line a quick ask's agent starts its answer with when the work needs a task: `TASK: <title>`, then why. */
const TASK_LINE = /^\s*TASK:\s*(.+?)\s*$/m;

/** What a quick ask's answer asks for: a task with this title and reason, or nothing (it answered). */
export function taskRequest(answer: string | null | undefined): { title: string; reason: string } | null {
  if (!answer) return null;
  const lines = answer.replace(/\r/g, '').split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return null;
  const m = TASK_LINE.exec(lines[first]);
  if (!m) return null;
  const title = m[1].replace(/\.$/, '').replace(/^["'`*]+|["'`*]+$/g, '').replace(/\.$/, '').trim().slice(0, 90);
  if (!title) return null;
  const reason = lines.slice(first + 1).join('\n').trim();
  return { title, reason };
}

/** One question and its answer, as the quick ask's turns hold them. */
export interface QuickTurn {
  question: string;
  answer: string | null;
}

const quote = (s: string) =>
  s
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

/**
 * The task thread's first message: what to do, then the quick ask so far, so the task starts from the answer instead
 * of asking again. `request` is Ben's ask for the task; left out, the last question is.
 */
export function taskPrompt(turns: readonly QuickTurn[], request?: string): string {
  const asked = turns.filter((t) => t.question.trim());
  const todo = (request?.trim() || asked[asked.length - 1]?.question || '').trim();
  const before = asked.filter((t) => t.answer?.trim() && !taskRequest(t.answer));
  if (!before.length) return todo;
  const lines = [todo, '', 'This started as a quick ask. What was asked and answered so far:'];
  for (const t of before) lines.push('', quote(`**Asked:** ${t.question}`), '>', quote(`**Answer:** ${t.answer}`));
  return lines.join('\n');
}

/** The rule a quick ask's agent runs under, in its system prompt (apps/server/runner/prompts.ts). */
export function quickAskRule(name: string): string[] {
  return [
    '## Quick ask',
    `${name} asked this from the quick ask box and reads your answer in place. Answer it directly and briefly: lead with the answer, then a source line when you looked something up.`,
    'You can read files, search and fetch the web, and read connectors. You cannot edit or write files, run commands, use a browser or delegate.',
    `When the request needs any of those (changing files or a store, running a command, browsing a site, making a file or a page, or work that runs long), do not attempt it and do not explain how to do it. Reply with exactly \`TASK: <a title of at most 8 words>\` on the first line, then one sentence on why it needs a task, then anything you already found that the task should start from. Omni turns it into a task thread and carries your answer over.`,
  ];
}

/**
 * Why a quick ask cannot run on Hermes or Cursor Cloud: Omni takes its write, shell and browser tools away on this
 * machine, and those run elsewhere. `where`: harness/types.ts providerWhere.
 */
export const quickAskRemoteRefusal = (where: string) =>
  `A quick ask runs on this machine with read-only tools, so it cannot run ${where}. Leave the harness on Auto or pick a local one, or make it a task.`;

/** What a key press in a quick ask box does: ask in place, make it a task, or make it a task and open it. */
export type QuickAskKey = 'ask' | 'task' | 'task-open';

/** Return asks, Shift-Return makes it a task, Cmd-Return (Ctrl-Return off the Mac) makes it a task and opens it. */
export function quickAskKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; isComposing?: boolean; keyCode?: number }): QuickAskKey | null {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.altKey) return null;
  if (e.metaKey || e.ctrlKey) return 'task-open';
  return e.shiftKey ? 'task' : 'ask';
}

/** Who promoted it: the agent's TASK line, Ben's "Make it a task", or Ben's "Keep as thread". */
export type Promotion = 'task' | 'keep';

/** The quick ask's line once it turned into a task. */
export const promotedLine = (auto: boolean) => (auto ? 'That needs real work, so I made it a task.' : 'Made it a task.');

/** An event as a client or the server holds it: the payload parsed, or still the stored JSON. */
export interface QuickEvent {
  kind: string;
  payload: unknown;
}

const payloadOf = (e: QuickEvent): Record<string, unknown> => {
  if (typeof e.payload !== 'string') return (e.payload ?? {}) as Record<string, unknown>;
  try {
    return JSON.parse(e.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** The quick ask's questions, each with the last text its turn wrote (null while none has come). */
export function quickTurns(events: readonly QuickEvent[]): QuickTurn[] {
  const turns: QuickTurn[] = [];
  for (const e of events) {
    const p = payloadOf(e);
    if (e.kind === 'user' && typeof p.text === 'string') turns.push({ question: p.text, answer: null });
    else if (e.kind === 'assistant_text' && typeof p.text === 'string' && p.text.trim() && turns.length) turns[turns.length - 1].answer = p.text;
  }
  return turns;
}

/** A quick ask as its answer card shows it, on web, phone and iOS. */
export interface QuickAskView {
  turns: QuickTurn[];
  /** It is answering: the newest question has no finished answer yet. */
  busy: boolean;
  /** The task thread it turned into, and whether its agent asked for that (TASK line) or Ben did. */
  promoted: { thread_id: string; title: string; auto: boolean } | null;
  /** Kept as a thread where it is (Keep as thread), so it now opens as one. */
  kept: boolean;
  /** The text Copy copies: the newest answer. */
  copy: string | null;
}

export function quickAskView(thread: { status: string; quick?: number | null; promoted_to?: string | null }, events: readonly QuickEvent[]): QuickAskView {
  const turns = quickTurns(events);
  let promoted: QuickAskView['promoted'] = null;
  for (const e of events) {
    if (e.kind !== 'promoted') continue;
    const p = payloadOf(e);
    if (typeof p.thread_id === 'string') promoted = { thread_id: p.thread_id, title: typeof p.title === 'string' ? p.title : '', auto: p.auto === true };
  }
  const busy = thread.status === 'running' || thread.status === 'queued';
  const last = turns[turns.length - 1];
  return { turns, busy, promoted, kept: !thread.quick && !thread.promoted_to && !promoted, copy: busy ? null : (last?.answer ?? null) };
}
