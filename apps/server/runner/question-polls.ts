// Which questions a call still waits on, in memory: after a restart none does. Its own file, importing nothing of the
// runner's, so approvals.ts can mark an approval waited on without joining the runner's lifecycle cycle.
import { publishFeed } from '../bus.ts';

/** When a tool call last polled each question, by question id. */
export const polled = new Map<string, number>();

/** Needs you recounts the thread's blockers. */
export const settled = (threadId: string) => publishFeed({ type: 'needs_you', thread_id: threadId });
