import type { ReactNode } from 'react';
import type { Thread } from '../../api.ts';
import { canMarkDone } from '../../needs-you.ts';
import { openMenu } from '../ContextMenu.tsx';
import { Button, IconButton, StatusPill } from '../ui.tsx';
import { ASKING_LABEL } from './QuestionCard.tsx';

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
  onPanel,
  artifactCount,
  asking = false,
}: {
  thread: Thread;
  meter: ReactNode;
  reconnecting: boolean;
  onDone: () => void;
  onRestore: () => void;
  restoring: boolean;
  panelOpen: boolean;
  onPanel: () => void;
  artifactCount: number;
  /** The agent waits on a question card. */
  asking?: boolean;
}) {
  const archived = !!thread.archived;
  const doneable = !archived && (!!thread.done_at || canMarkDone(thread.status));
  return (
    <div className="flex shrink-0 items-center gap-1">
      {reconnecting && (
        <span className="hidden items-center gap-1.5 font-num text-[11px] text-fg-3 sm:inline-flex" title="Reconnecting to the live stream">
          <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> Reconnecting
        </span>
      )}
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
      <StatusPill status={asking ? 'needs' : thread.status} label={asking ? ASKING_LABEL : undefined} />
      <IconButton
        icon="more"
        label="Thread actions"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu({ kind: 'thread', id: thread.id }, r.left, r.bottom + 6);
        }}
      />
      <span className="relative">
        <IconButton icon="panel" label="Artifacts, changes, browser, terminal, actions, details" active={panelOpen} onClick={onPanel} />
        {artifactCount > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-fg px-1 font-num text-[9.5px] text-on-ink">{artifactCount}</span>
        )}
      </span>
    </div>
  );
}
