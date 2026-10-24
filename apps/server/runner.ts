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
import './runner/switch.ts';
import './runner/questions.ts';

export type { ActiveTask, ModStatus, Msg, PendingMsg, SendMode } from './runner/state.ts';
export type { Acceptance, CreateThreadInput, PostedThread } from './runner/api.ts';

export {
  activeMods,
  activeTasks,
  emitThread,
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
export { interruptThread, releaseForHandoff, shutdownAll, stopThread } from './runner/session.ts';
export { retrySetup } from './runner/setup.ts';
export { switchRun } from './runner/switch.ts';
export { cancelLimitResume, clearLimit, fireDue, limitClock, resumeLimitNow, scheduleLimitResume, startLimits } from './runner/limits.ts';
export { reportToParent, saveOwn, settleTeam, wake } from './runner/queue.ts';
export { buildSystemPrompt } from './runner/prompts.ts';
export { answerQuestion, askQuestion, awaitAnswer, WAIT_MAX_SEC } from './runner/questions.ts';
