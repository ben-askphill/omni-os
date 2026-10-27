import type { ReactNode } from 'react';
import type { Thread } from '../../api.ts';
import { canMarkDone } from '../../needs-you.ts';
import { openMenu } from '../ContextMenu.tsx';
import { Button, IconButton, StatusPill } from '../ui.tsx';
import { ASKING_LABEL } from './QuestionCard.tsx';

// Below this header width (the side panel open, a small window) pin, done, hand off and Send to Grok Bot fold into one More button and
// Interrupt drops its label, so the title keeps its room. The header is the @container; 3xl is 48rem.
export const FOLD = '@max-3xl:hidden';
export const UNFOLD = '@3xl:hidden';

export function HeaderActions({
  thread,
  meter,
  reconnecting,
  handoffReady,
  onPin,
  onDone,
  onRestore,
  restoring,
  grok,
  interrupt,
  panelOpen,
  onPanel,
  artifactCount,
  asking = false,
}: {
  thread: Thread;
  meter: ReactNode;
  reconnecting: boolean;
  handoffReady: boolean;
  onPin: () => void;
  onDone: () => void;
  onRestore: () => void;
  restoring: boolean;
  grok: { busy: boolean; run: () => void };
  /** Set while a turn runs that can be interrupted. */
  interrupt: { busy: boolean; run: () => void } | null;
  panelOpen: boolean;
  onPanel: () => void;
  artifactCount: number;
  /** The agent waits on a question card. */
  asking?: boolean;
}) {
  const archived = !!thread.archived;
  const doneable = !archived && (!!thread.done_at || canMarkDone(thread.status));
  const menuAt = (el: HTMLElement, handoff?: boolean) => {
    const r = el.getBoundingClientRect();
    openMenu({ kind: 'thread', id: thread.id }, r.left, r.bottom + 6, handoff);
  };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {reconnecting && (
        <span className="hidden items-center gap-1.5 font-num text-[11px] text-fg-3 sm:inline-flex" title="Reconnecting to the live stream">
          <span className="pulse h-1.5 w-1.5 rounded-full bg-fg-4" /> Reconnecting
        </span>
      )}
      {meter}
      {!archived && (
        <IconButton
          icon="pin"
          label={thread.pinned_at ? 'Unpin thread' : 'Pin thread'}
          title={thread.pinned_at ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
          active={!!thread.pinned_at}
          aria-pressed={!!thread.pinned_at}
          className={FOLD}
          onClick={onPin}
        />
      )}
      {doneable && (
        <IconButton
          icon="check"
          label={thread.done_at ? 'Mark as not done' : 'Mark as done'}
          title={thread.done_at ? 'Marked done. Click to bring it back to Needs you.' : 'Mark as done: out of Needs you until something new happens here'}
          active={!!thread.done_at}
          aria-pressed={!!thread.done_at}
          className={FOLD}
          onClick={onDone}
        />
      )}
      {archived && (
        <Button size="sm" variant="secondary" icon="archive" onClick={onRestore} busy={restoring} title="Archived. Restore it to its channel's thread list.">
          Restore
        </Button>
      )}
      <Button size="sm" variant="ghost" icon="external" busy={grok.busy} title="Send this thread's text to Grok Bot" className={FOLD} onClick={grok.run}>
        Send to Grok Bot
      </Button>
      <StatusPill status={asking ? 'needs' : thread.status} label={asking ? ASKING_LABEL : undefined} />
      {handoffReady && (
        <IconButton
          icon="share"
          label="Hand off to another Mac"
          title="Hand off to another Mac: a running turn carries on there, an idle thread continues there with your next message"
          aria-haspopup="menu"
          className={FOLD}
          onClick={(e) => menuAt(e.currentTarget, true)}
        />
      )}
      {/* The thread menu holds pin, done, hand off and Send to Grok Bot, and more. */}
      {!archived && <IconButton icon="more" label="Thread actions" aria-haspopup="menu" className={UNFOLD} onClick={(e) => menuAt(e.currentTarget)} />}
      {interrupt && (
        <Button
          size="sm"
          variant="secondary"
          icon="stop"
          onClick={interrupt.run}
          busy={interrupt.busy}
          title="Interrupt the agent (Esc). Messages already sent still run."
          aria-label={interrupt.busy ? 'Interrupting' : 'Interrupt'}
          aria-keyshortcuts="Escape"
          className="@max-3xl:px-2"
        >
          <span className="@max-3xl:sr-only">{interrupt.busy ? 'Interrupting' : 'Interrupt'}</span>
        </Button>
      )}
      <span className="relative">
        <IconButton icon="panel" label="Artifacts, changes, browser, terminal, actions, details" active={panelOpen} onClick={onPanel} />
        {artifactCount > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-fg px-1 font-num text-[9.5px] text-on-ink">{artifactCount}</span>
        )}
      </span>
    </div>
  );
}
