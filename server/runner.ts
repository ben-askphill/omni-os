// Public runner API. Lifecycle is split under ./runner/; callers keep importing this file.
import './runner/queue.ts';
import './runner/records.ts';
import './runner/spawn.ts';
import './runner/aux.ts';
import './runner/prompts.ts';
import './runner/api.ts';

export type { ActiveTask, PendingMsg, SendMode } from './runner/state.ts';
export type { CreateThreadInput } from './runner/api.ts';

export {
  activeTasks,
  isLive,
  pendingFor,
  queuedCount,
  runningByHarness,
  runningCount,
  runsHere,
  slotsByHarness,
  threadCommands,
} from './runner/state.ts';

export { createThread, postMessage, sendMessage } from './runner/api.ts';
export { interruptThread, shutdownAll, stopThread } from './runner/session.ts';
export { buildSystemPrompt } from './runner/prompts.ts';
