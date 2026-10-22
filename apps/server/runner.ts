// Public runner API. Lifecycle is split under ./runner/; callers keep importing this file.
import './runner/queue.ts';
import './runner/records.ts';
import './runner/spawn.ts';
import './runner/aux.ts';
import './runner/prompts.ts';
import './runner/api.ts';
import './runner/pending.ts';
import './runner/setup.ts';
import './runner/limits.ts';

export type { ActiveTask, ModStatus, PendingMsg, SendMode } from './runner/state.ts';
export type { Acceptance, CreateThreadInput, PostedThread } from './runner/api.ts';

export {
  activeMods,
  activeTasks,
  isLive,
  pendingFor,
  queuedCount,
  refreshContext,
  runningByHarness,
  runningCount,
  runsHere,
  slotsByHarness,
  threadCommands,
} from './runner/state.ts';

export { acceptedAgain, createTeam, createThread, discardRequests, postMessage, resumeRequests, sendMessage } from './runner/api.ts';
export { ALREADY_SENT, cancelRequests, editRequest, reorderRequests, steerRequests } from './runner/pending.ts';
export { interruptThread, shutdownAll, stopThread } from './runner/session.ts';
export { retrySetup } from './runner/setup.ts';
export { cancelLimitResume, clearLimit, fireDue, limitClock, resumeLimitNow, scheduleLimitResume, startLimits } from './runner/limits.ts';
export { reportToParent, settleTeam } from './runner/queue.ts';
export { buildSystemPrompt } from './runner/prompts.ts';
