// Running the Omni command a reply starts with (`/rename`, `/clear`, `/model`), for the desktop reply box and the phone
// composer alike. Which command it is, and whether Send runs it, is replySlash's (packages/shared/composer-slash.ts).
import { newThreadBody, type ReplyAction } from '@omni/shared/composer-slash.ts';
import { api, errorText, type Thread } from '../../api.ts';
import { keepLocalFiles } from '../../sending.ts';

/** What the composer does around a command: each surface opens its own picker and new-thread composer. */
export interface ReplyCommandHooks {
  /** The command left the box: clear what was sent. `files`: the attachments went with it, so clear them too. */
  sent: (files: boolean) => void;
  /** `/clear` or `/new` with no prompt: the new-thread composer, set to this thread's settings. */
  openNew: () => void;
  /** `/model`, `/effort` or `/fast`: the composer's model picker, whose pick switches the next turn. */
  pickModel: () => void;
  /** `/clear <prompt>` started this thread. */
  started: (t: Thread) => void;
  renamed: (t: Thread) => void;
  busy: (on: boolean) => void;
  error: (why: string | null) => void;
}

/** Run it. The thread itself sees none of it. */
export async function runReplyCommand(action: ReplyAction, thread: Thread, files: File[], on: ReplyCommandHooks): Promise<void> {
  if (action.kind === 'send') return;
  if (action.kind === 'pick-model') {
    on.sent(false);
    return on.pickModel();
  }
  if (action.kind === 'new-thread' && !action.prompt) {
    on.sent(false);
    return on.openNew();
  }
  on.busy(true);
  on.error(null);
  try {
    if (action.kind === 'new-thread') {
      const t = await api.send<Thread>('/threads', newThreadBody(thread, action.prompt), files);
      keepLocalFiles(t.id, files);
      on.sent(true);
      on.started(t);
    } else {
      const t = await api.patch<Thread>(`/threads/${encodeURIComponent(thread.id)}`, { title: action.title });
      on.sent(false);
      on.renamed(t);
    }
  } catch (e) {
    on.error(errorText(e));
  } finally {
    on.busy(false);
  }
}
