import type { ReactNode } from 'react';
import type { Thread } from '../../api.ts';
import type { TurnPhase } from '@omni/shared/status.ts';
import { canMarkDone } from '../../needs-you.ts';
import { useNeedOf, useNow } from '../../store.tsx';
import { threadPill } from './thread-state.ts';
import { closeMenu, openMenu, useMenuOpenFor } from '../ContextMenu.tsx';
import { Button, IconButton, StatusPill } from '../ui.tsx';

// The header keeps the context meter, Done (Restore on an archived thread), the status, the thread menu and the panel
// toggle. Pin, rename, move, archive, fork, reference, hand off and Send to Grok Bot are in the thread menu (⋯), the
// list in packages/shared/thread-actions.ts that the right-click renders too.
export function HeaderActions({
  thread,
  meter,
  reconnecting,
  onDone,
  onRestore,
  restoring,
  panelOpen,
  panelSurface,
  onPanel,
  artifactCount,
  asking = false,
  turn,
  pr,
}: {
  thread: Thread;
  meter: ReactNode;
  reconnecting: boolean;
  onDone: () => void;
  onRestore: () => void;
  restoring: boolean;
  panelOpen: boolean;
  /** When the full inspector is open, the toggle title names it; otherwise the quick card. */
  panelSurface?: 'collapsed' | 'card' | 'inspector';
  onPanel: () => void;
  artifactCount: number;
  /** The agent waits on a question card. */
  asking?: boolean;
  /** What the running turn is doing, for the pill's dot. */
  turn?: TurnPhase | null;
  /** The pull request on the thread's branch: finished with one open, the pill reads Ready for review. */
  pr?: { state?: string; isDraft: boolean } | null;
}) {
  const menuOpen = useMenuOpenFor('thread', thread.id);
  const now = useNow(60_000);
  const need = useNeedOf(thread.id);
  const pill = threadPill(thread, { asking, reconnecting, now, turn, need, pr });
  const archived = !!thread.archived;
  const doneable = !archived && (!!thread.done_at || canMarkDone(thread.status));
  return (
    <div className="flex shrink-0 items-center gap-1">
      {meter}
      {doneable && (
        <IconButton
          icon="check"
          label={thread.done_at ? 'Mark as not done' : 'Mark as done'}
          title={thread.done_at ? 'Marked done. Click to bring it back to Needs you.' : 'Mark as done: out of Needs you until something new happens here'}
          active={!!thread.done_at}
          aria-pressed={!!thread.done_at}
          onClick={onDone}
        />
      )}
      {archived && (
        <Button size="sm" variant="secondary" icon="archive" onClick={onRestore} busy={restoring} title="Archived. Restore it to its channel's thread list.">
          Restore
        </Button>
      )}
      <span className="inline-flex" title={reconnecting ? 'Reconnecting to the live stream. The thread keeps running on the server.' : undefined}>
        <StatusPill mark={pill.mark} label={pill.label} />
      </span>
      <IconButton
        icon="more"
        label="Thread actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          if (menuOpen) return closeMenu();
          const r = e.currentTarget.getBoundingClientRect();
          openMenu({ kind: 'thread', id: thread.id }, r.right, r.bottom + 6, 'end', e.currentTarget);
        }}
      />
      <span className="relative">
        <IconButton
          icon="panel"
          label={
            panelSurface === 'inspector'
              ? 'Close full inspector'
              : panelOpen
                ? 'Hide quick actions'
                : 'Show quick actions'
          }
          active={panelOpen}
          onClick={onPanel}
        />
        {artifactCount > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-fg px-1 font-num text-[9.5px] text-on-ink">{artifactCount}</span>
        )}
      </span>
    </div>
  );
}
