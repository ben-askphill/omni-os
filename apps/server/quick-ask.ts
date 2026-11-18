// A quick ask turning into a thread (packages/shared/quick-ask.ts): kept in place, or a new task thread that starts
// from the answer. Only Ben does either (Keep as thread, Make it a task). The agent's TASK line only suggests a task:
// a quick ask reads pages and connectors it cannot trust, so its answer never starts a thread with write access.
import { addEvent, emitThread } from './runner/state.ts';
import { createThread, type CreateThreadInput } from './runner/api.ts';
import { events, threads, type Thread } from './db.ts';
import { quickTurns, readsOnly, taskPrompt, taskRequest, TASK_SUGGESTED } from '@omni/shared/quick-ask.ts';

export class QuickAskRefusal extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

/**
 * Start a quick ask: the one entry point, for POST /api/threads with `quick` and for any later caller (the @agent
 * Ask). It answers in place with read-only tools, on Auto unless a run is given, with no charter, worktree, folder or
 * task id, and stays out of every list but Recent asks.
 */
export const startQuickAsk = (input: Omit<CreateThreadInput, 'quick' | 'role' | 'folder' | 'parent_id' | 'task_id' | 'review_of' | 'base'>) =>
  createThread({ ...input, quick: true });

/**
 * Keep it where it is: an ordinary thread from here on, in its lists and the Inbox. Its workspace stays `read` or
 * `none`, so it stays read-only (readsOnly): work it turns out to need still goes to a task thread.
 */
export function keepQuickAsk(id: string): Thread {
  const t = threads.get(id);
  if (!t) throw new QuickAskRefusal(`No thread "${id}".`, 404);
  if (t.quick && threads.setQuick(id, { quick: 0 })) emitThread(id);
  return threads.get(id)!;
}

/**
 * A task thread in the same channel, with the quick ask's questions and answers in its first message. The Conductor
 * channel starts it as the Conductor, as the new-thread composer does. `request`: what Ben asked the task to do; left
 * out, the last question. Once is enough: a second call returns the task the first made.
 */
export async function taskFromQuickAsk(id: string, opts: { request?: string; title?: string } = {}): Promise<{ ask: Thread; task: Thread }> {
  const t = threads.get(id);
  if (!t) throw new QuickAskRefusal(`No thread "${id}".`, 404);
  const made = t.promoted_to ? threads.get(t.promoted_to) : undefined;
  if (made) return { ask: t, task: made };
  if (!readsOnly(t)) throw new QuickAskRefusal('Only a quick ask, or a thread kept from one, turns into a task.', 409);
  const all = events.since(id);
  const turns = quickTurns(all);
  // The title its agent suggested, unless Ben said what the task is.
  const suggested = opts.request ? undefined : all.findLast((e) => e.kind === TASK_SUGGESTED);
  const title = opts.title ?? (suggested ? (JSON.parse(suggested.payload) as { title?: string }).title : undefined);
  const prompt = taskPrompt(turns, opts.request);
  if (!prompt.trim()) throw new QuickAskRefusal('The quick ask has nothing to start a task from.', 409);
  const task = await createThread({
    channel: t.channel_id,
    prompt,
    ...(t.channel_id === 'conductor' && { role: 'conductor' }),
    ...(title && { title }),
    source: 'capture',
  });
  threads.setQuick(id, { quick: 0, promoted_to: task.id });
  addEvent(id, 'promoted', { thread_id: task.id, title: task.title });
  emitThread(id);
  return { ask: threads.get(id)!, task };
}

/**
 * After a quick ask's turn: a TASK line is recorded as a suggested task, which shows under the answer with Make it a
 * task. Nothing starts until Ben presses it.
 */
export async function afterQuickTurn(id: string, reply: string): Promise<void> {
  const t = threads.get(id);
  if (!t?.quick) return;
  const asked = taskRequest(reply);
  if (!asked) return;
  addEvent(id, TASK_SUGGESTED, asked);
  emitThread(id);
}
