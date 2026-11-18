// A quick ask turning into a thread (packages/shared/quick-ask.ts): kept in place, or a new task thread that starts
// from the answer. The agent asks for a task with its TASK line; Ben asks with Keep as thread or Make it a task.
import { addEvent, emitThread } from './runner/state.ts';
import { createThread, type CreateThreadInput } from './runner/api.ts';
import { artifacts, events, threads, type Thread } from './db.ts';
import { quickTurns, taskPrompt, taskRequest } from '@omni/shared/quick-ask.ts';

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

/** Keep it where it is: an ordinary thread from here on, in its lists and the Inbox. */
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
export async function taskFromQuickAsk(id: string, opts: { request?: string; title?: string; auto?: boolean } = {}): Promise<{ ask: Thread; task: Thread }> {
  const t = threads.get(id);
  if (!t) throw new QuickAskRefusal(`No thread "${id}".`, 404);
  const made = t.promoted_to ? threads.get(t.promoted_to) : undefined;
  if (made) return { ask: t, task: made };
  if (!t.quick) throw new QuickAskRefusal('Only a quick ask turns into a task.', 409);
  const turns = quickTurns(events.since(id));
  const prompt = taskPrompt(turns, opts.request);
  if (!prompt.trim()) throw new QuickAskRefusal('The quick ask has nothing to start a task from.', 409);
  const task = await createThread({
    channel: t.channel_id,
    prompt,
    ...(t.channel_id === 'conductor' && { role: 'conductor' }),
    ...(opts.title && { title: opts.title }),
    source: 'capture',
  });
  threads.setQuick(id, { quick: 0, promoted_to: task.id });
  addEvent(id, 'promoted', { thread_id: task.id, title: task.title, auto: !!opts.auto });
  emitThread(id);
  return { ask: threads.get(id)!, task };
}

/**
 * After a quick ask's turn: a TASK line turns it into a task, and a file it made keeps it as a thread, so the file
 * has somewhere to live. Anything else stays a quick ask.
 */
export async function afterQuickTurn(id: string, reply: string): Promise<void> {
  const t = threads.get(id);
  if (!t?.quick) return;
  const asked = taskRequest(reply);
  if (asked) {
    await taskFromQuickAsk(id, { title: asked.title, auto: true }).catch((err) =>
      addEvent(id, 'error', { text: `Could not turn this into a task: ${(err as Error).message}` }),
    );
    return;
  }
  if (artifacts.byThread(id).length) keepQuickAsk(id);
}
