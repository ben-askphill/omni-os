// What the composer's Send does with an Omni command (`/rename`, `/clear`, `/model`): the rules are the Web UI's reply
// box's (replySlash in packages/shared/composer-slash.ts), carried out with the app's own sheet and screens.
import type { CreateThreadRequest } from '@omni/client-core';
import { newThreadBody, sameRun, type ReplyAction, type ThreadSettings } from '@omni/shared/composer-slash.ts';
import type { DraftRun } from '@omni/shared/draft-run.ts';

export type CommandStep =
  /** Not an Omni command: the message goes to the thread as typed, and the server runs any harness command it names. */
  | { kind: 'send' }
  /** `/model`, `/effort` or `/fast`: the run sheet, whose pick switches the next turn. */
  | { kind: 'pick-model' }
  /** `/clear` or `/new` on its own: the New screen, set to this thread's channel and run. */
  | { kind: 'open-new'; channel: string; run: DraftRun }
  /** `/clear <prompt>`: a new thread with this one's settings, started at once. This one stays as it is. */
  | { kind: 'start'; body: Omit<CreateThreadRequest, 'id'> }
  | { kind: 'rename'; title: string };

export function commandStep(action: ReplyAction, thread: ThreadSettings): CommandStep {
  switch (action.kind) {
    case 'new-thread':
      return action.prompt ? { kind: 'start', body: newThreadBody(thread, action.prompt) } : { kind: 'open-new', channel: thread.channel_id, run: sameRun(thread) };
    case 'rename':
      return { kind: 'rename', title: action.title };
    default:
      return { kind: action.kind };
  }
}
