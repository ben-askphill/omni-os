// The sidebar Inbox's rows (apps/web/src/components/sidebar/InboxView.tsx) on the phone's Activity tab, on the mobile
// parts: a thread with its status, a Done row, and a shelf's header. A row's actions are laid over its right end as
// siblings of its button, so tapping one never opens the thread.
import { errorText, type Thread, type ThreadStub } from '../api.ts';
import type { InboxShelf } from '../app/useInbox.ts';
import { DelegateCount, DelegateCountSpace, delegatesHref, useDelegateSummary } from '../components/DelegateCount.tsx';
import { DoneMark, Icon, type IconName } from '../components/ui.tsx';
import type { InboxThread, RowStatus } from '../inbox.ts';
import { canMarkDone } from '../needs-you.ts';
import { href } from '../router.ts';
import { useApp, useNow } from '../store.tsx';
import { MoAvatar, MoRound } from './parts.tsx';
import { shortTime } from './rows.ts';
import { useShell } from './shell.tsx';

interface RowAction {
  icon: IconName;
  label: string;
  run: () => void;
}

const ACTION = 36;
const ACTION_GAP = 4;
/** What a row's text leaves free at its end for the actions, so the title truncates before them. */
const actionsWidth = (n: number) => (n ? n * ACTION + (n - 1) * ACTION_GAP : 0);

/** Mark done, undo and unpin, each answered with a toast, or the server's error, as in Thread options. */
function useRowActions() {
  const shell = useShell();
  const { setDone, setPinned } = useApp();
  const run = (p: Promise<unknown>, ok: string) => void p.then(() => shell.toast(ok), (e: unknown) => shell.toast(errorText(e)));
  return {
    done: (t: InboxThread) => run(setDone(t.id, true), 'Marked done'),
    undo: (t: InboxThread) => run(setDone(t.id, false), 'Back in the inbox'),
    unpin: (t: InboxThread) => run(setPinned(t, false), 'Unpinned'),
  };
}

function RowActions({ actions }: { actions: RowAction[] }) {
  if (!actions.length) return null;
  return (
    <span className="absolute top-1/2 right-0 flex -translate-y-1/2" style={{ gap: ACTION_GAP }}>
      {actions.map((a) => (
        <MoRound key={a.icon} label={a.label} onClick={a.run} size={ACTION} quiet>
          <Icon name={a.icon} size={18} className="text-fg-3" />
        </MoRound>
      ))}
    </span>
  );
}

/** A thread as the sidebar's Inbox card: its status on the avatar and on the right, the title, the channel and branch. */
export function MoInboxRow({
  t,
  status,
  delegated,
  pinned = false,
  last,
}: {
  t: InboxThread & Partial<Pick<Thread, 'branch' | 'role'>>;
  status: RowStatus | null;
  delegated: readonly ThreadStub[] | undefined;
  pinned?: boolean;
  last: boolean;
}) {
  const shell = useShell();
  const { channel } = useApp();
  const now = useNow(60_000);
  const act = useRowActions();
  const summary = useDelegateSummary(delegated);
  const ch = channel(t.channel_id);
  const title = t.title || 'Untitled';
  // Work in progress recedes, as on the desktop card: what waits on Ben stands out.
  const receded = status?.glyph === 'running';
  const actions: RowAction[] = [];
  if (pinned) actions.push({ icon: 'pin', label: `Unpin ${title}`, run: () => act.unpin(t) });
  if (canMarkDone(t.status)) actions.push({ icon: 'check', label: `Mark ${title} done`, run: () => act.done(t) });
  const reserve = actionsWidth(actions.length);
  return (
    <div className="relative">
      <button type="button" onClick={() => shell.open(href.thread(t.id))} className="mo-row flex min-w-0 w-full items-center gap-3 px-1 py-2.5 text-left">
        <MoAvatar role={t.role} channel={t.channel_id} channelIcon={ch?.icon} state={status?.glyph ?? t.status} />
        <span className={`-mb-2.5 flex min-w-0 flex-1 flex-col gap-0.5 pb-2.5 ${last ? '' : 'border-b border-line'}`} style={{ paddingRight: reserve }}>
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[15px] leading-[1.3] ${receded ? 'text-fg-3' : 'text-fg'}`}>{title}</span>
            <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{status ? status.label : shortTime(t.updated_at ?? t.created_at, now)}</span>
          </span>
          <span className="flex items-center gap-2 text-[12.5px] leading-[1.35] text-fg-3">
            {pinned && <Icon name="pin" size={12} className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{[`#${ch?.name ?? t.channel_id}`, t.branch].filter(Boolean).join(' · ')}</span>
            {summary && <DelegateCountSpace summary={summary} size={13} />}
          </span>
        </span>
      </button>
      {summary && (
        <span className="absolute bottom-2.5 flex" style={{ right: reserve }}>
          <DelegateCount summary={summary} size={13} onOpen={() => shell.open(delegatesHref(t.id))} />
        </span>
      )}
      <RowActions actions={actions} />
    </div>
  );
}

/** A Done row: the check, the title and when it was marked done, with an undo. */
export function MoDoneRow({ t, last }: { t: InboxThread; last: boolean }) {
  const shell = useShell();
  const now = useNow(60_000);
  const act = useRowActions();
  const title = t.title || 'Untitled';
  return (
    <div className="relative">
      <button type="button" onClick={() => shell.open(href.thread(t.id))} className="mo-row flex min-w-0 w-full items-center gap-3 px-1 text-left">
        <span className="grid w-9 shrink-0 place-items-center">
          <DoneMark size={9} />
        </span>
        <span className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 ${last ? '' : 'border-b border-line'}`} style={{ paddingRight: actionsWidth(1) }}>
          <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.3] text-fg-3">{title}</span>
          <span className="shrink-0 text-[12px] leading-none text-fg-4 tabular-nums">{shortTime(t.done_at ?? t.updated_at ?? t.created_at, now)}</span>
        </span>
      </button>
      <RowActions actions={[{ icon: 'undo', label: `Move ${title} back to the inbox`, run: () => act.undo(t) }]} />
    </div>
  );
}

/** A shelf's header: its name, how many it holds, and a chevron that turns as it folds. */
export function MoShelf({ label, shelf }: { label: string; shelf: InboxShelf }) {
  return (
    <button type="button" onClick={shelf.toggle} aria-expanded={shelf.open} className="mo-row flex h-11 w-full items-center gap-1.5 px-1 text-left">
      <span className="text-[12px] leading-[1.3] font-medium text-fg-3">{label}</span>
      <span className="text-[12px] leading-[1.3] text-fg-4 tabular-nums">{shelf.count}</span>
      <Icon name="chevronDown" size={14} className={`ml-auto text-fg-4 transition-transform ${shelf.open ? '' : '-rotate-90'}`} />
    </button>
  );
}

/** Under an open Done shelf that holds more than it lists. */
export function MoShowMore({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mo-row flex h-11 w-full items-center gap-3 px-1 text-left text-[13px] text-fg-3">
      <span className="grid w-9 shrink-0 place-items-center">
        <Icon name="chevronDown" size={14} />
      </span>
      Show {count} more
    </button>
  );
}
