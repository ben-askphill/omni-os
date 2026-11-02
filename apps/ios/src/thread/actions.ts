import type { OmniApi, Thread } from '@omni/client-core';
import type { ThreadActionId } from '@omni/shared/thread-actions.ts';

import type { ThreadTarget } from './target';

export type ThreadActionApi = Pick<OmniApi, 'setPinned' | 'setDone' | 'rename' | 'setArchived' | 'moveToFolder'>;

export type ThreadAction =
  | { kind: 'pin' }
  | { kind: 'done' }
  | { kind: 'archive' }
  | { kind: 'rename'; title: string }
  | { kind: 'move'; folderId: string | null };

/** The Organize ids from the shared list, which are the ones this client runs. */
export type OrganizeActionId = Extract<ThreadActionId, 'pin' | 'done' | 'rename' | 'move' | 'archive'>;

export type ActionOutcome =
  /** The server changed the thread; `thread` is its row now. */
  | { kind: 'changed'; thread: Thread; message: string }
  /** The action asked for what the thread already is (a rename to the same title, a move to its own folder). */
  | { kind: 'unchanged' }
  | { kind: 'failed'; error: string };

/** One line, as the server stores it: runs of whitespace collapse and the ends are trimmed. */
export const normalizeTitle = (title: string) => title.replace(/\s+/g, ' ').trim();

/** The toast-sized line that says what an action did, for the state it left the thread in. */
export function changedMessage(action: ThreadAction['kind'], after: ThreadTarget): string {
  switch (action) {
    case 'pin':
      return after.pinned ? 'Pinned' : 'Unpinned';
    case 'done':
      return after.done ? 'Marked done' : 'Back in Needs you';
    case 'archive':
      return after.archived ? 'Archived. Search still finds it.' : 'Back in the lists';
    case 'rename':
      return 'Renamed';
    case 'move':
      return after.folderId ? 'Moved to folder' : 'Moved out of its folder';
  }
}

/**
 * Runs one Organize action against the server. A refusal (a 409 for pinning an archived thread or marking a running one
 * done) comes back as `failed` with the server's words, so a caller shows it and leaves the thread as it was.
 */
export async function runThreadAction(
  api: ThreadActionApi,
  target: ThreadTarget,
  action: ThreadAction,
  after: (thread: Thread) => ThreadTarget,
): Promise<ActionOutcome> {
  try {
    const thread = await send(api, target, action);
    if (!thread) return { kind: 'unchanged' };
    return { kind: 'changed', thread, message: changedMessage(action.kind, after(thread)) };
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error && e.message ? e.message : 'Something went wrong' };
  }
}

function send(api: ThreadActionApi, target: ThreadTarget, action: ThreadAction): Promise<Thread | null> | Thread | null {
  switch (action.kind) {
    case 'pin':
      return api.setPinned(target.id, !target.pinned);
    case 'done':
      return api.setDone(target.id, !target.done);
    case 'archive':
      return api.setArchived(target.id, !target.archived);
    case 'rename': {
      const title = normalizeTitle(action.title);
      return title && title !== target.title ? api.rename(target.id, title) : null;
    }
    case 'move':
      return action.folderId === target.folderId ? null : api.moveToFolder(target.id, action.folderId);
  }
}
