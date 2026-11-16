// The sidebar Inbox's rows (apps/web/src/components/sidebar/InboxView.tsx) on the phone's Activity tab, on the mobile
// parts: a thread with its status, a Done row, and a shelf's header. A row's actions are laid over its right end as
// siblings of its button, so tapping one never opens the thread.
import { errorText, type Thread } from '../api.ts';
import type { InboxShelf } from '../app/useInbox.ts';
import { AgentRows, FoldTrees, TreeRows, TreeToggle, TreeToggleSpace } from '../components/ThreadTree.tsx';
import { useMarkDone } from '../done-confirm.tsx';
import { useJobTree, type TreesFold } from '../thread-tree.ts';
import { DoneMark, Icon, type IconName } from '../components/ui.tsx';
import { RunElapsed } from '../components/RunElapsed.tsx';
import { ranOnLine } from '@omni/shared/ran-on.ts';
import { threadPhase, type RowStatus } from '@omni/shared/status.ts';
import type { InboxThread } from '../inbox.ts';
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
  const { setPinned } = useApp();
  const markDone = useMarkDone();
  const run = (p: Promise<unknown>, ok: string) =>
    void p.then((r) => r !== null && shell.toast(ok), (e: unknown) => shell.toast(errorText(e)));
  return {
    // A job with work still going under it asks first; cancelling it says nothing.
    done: (t: InboxThread) => run(markDone(t, true), 'Marked done'),
    undo: (t: InboxThread) => run(markDone(t, false), 'Back in the inbox'),
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

/**
 * A thread as the sidebar's Inbox card: its status on the avatar and on the right, the title, the channel and the
 * machine. A job has its tally at the end of the second line and its tree under it. `working`: the row is on the
 * Working shelf, so what runs under it shows too.
 */
export function MoInboxRow({
  t,
  status,
  working = false,
  pinned = false,
  last,
}: {
  t: InboxThread & Partial<Pick<Thread, 'branch' | 'role'>>;
  status: RowStatus | null;
  working?: boolean;
  pinned?: boolean;
  last: boolean;
}) {
  const shell = useShell();
  const { channel } = useApp();
  const now = useNow(60_000);
  const act = useRowActions();
  const { tasks } = useApp();
  const tree = useJobTree(t, 'inbox');
  const own = working ? tasks.filter((k) => k.thread_id === t.id && k.subagent) : [];
  const ch = channel(t.channel_id);
  const title = t.title || 'Untitled';
  const phase = threadPhase(t);
  // The machine it runs on or last ran on, then the run's time; the branch only without a machine.
  const where = ranOnLine(t, now);
  const label = where.machine ?? where.branch;
  const actions: RowAction[] = [];
  if (pinned) actions.push({ icon: 'pin', label: `Unpin ${title}`, run: () => act.unpin(t) });
  if (canMarkDone(t.status)) actions.push({ icon: 'check', label: `Mark ${title} done`, run: () => act.done(t) });
  const reserve = actionsWidth(actions.length);
  const under = !!tree || own.length > 0;
  return (
    <div>
    <div className="relative">
      <button type="button" onClick={() => shell.open(href.thread(t.id))} className="mo-row flex min-w-0 w-full items-center gap-3 px-1 py-2.5 text-left">
        <MoAvatar role={t.role} channel={t.channel_id} channelIcon={ch?.icon} avatarBg={ch?.avatar_bg} state={status?.glyph ?? (phase ? 'running' : t.status)} phase={phase} />
        <span className={`-mb-2.5 flex min-w-0 flex-1 flex-col gap-0.5 pb-2.5 ${last || under ? '' : 'border-b border-line'}`} style={{ paddingRight: reserve }}>
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] leading-[1.3] text-fg">{title}</span>
            <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{status ? status.label : shortTime(t.updated_at ?? t.created_at, now)}</span>
          </span>
          <span className="flex items-center gap-2 text-[12.5px] leading-[1.35] text-fg-3">
            {pinned && <Icon name="pin" size={12} className="shrink-0" />}
            <span className={`min-w-0 truncate ${label ? 'max-w-[45%] shrink-0' : 'flex-1'}`}>#{ch?.name ?? t.channel_id}</span>
            {label && (
              <span className="-ml-1 flex min-w-0 flex-1 items-center gap-1" title={where.title || undefined} data-ran-on={where.machine ?? undefined}>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">{label}</span>
                {t.run_started_at && <span aria-hidden>·</span>}
                <RunElapsed since={t.run_started_at} />
              </span>
            )}
            {!label && <RunElapsed since={t.run_started_at} />}
            {tree && (
              <TreeToggleSpace tree={tree} className="ml-auto h-7 px-1" />
            )}
          </span>
        </span>
      </button>
      {tree && (
        <span className="absolute bottom-1 flex" style={{ right: reserve }}>
          <TreeToggle tree={tree} title={title} className="h-7 px-1" />
        </span>
      )}
      <RowActions actions={actions} />
    </div>
      {under && (
        <div className={`ml-[22px] pb-1.5 ${last ? '' : 'border-b border-line'}`}>
          {own.length > 0 && <AgentRows tasks={own} variant="phone" />}
          {tree && <TreeRows tree={tree} variant="phone" agents={working ? tasks : undefined} />}
        </div>
      )}
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
          <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{shortTime(t.done_at ?? t.updated_at ?? t.created_at, now)}</span>
        </span>
      </button>
      <RowActions actions={[{ icon: 'undo', label: `Move ${title} back to the inbox`, run: () => act.undo(t) }]} />
    </div>
  );
}

/** A shelf's header: its name, how many it holds, and a chevron that turns as it folds. */
export function MoShelf({ label, shelf, fold }: { label: string; shelf: InboxShelf; fold?: TreesFold }) {
  return (
    <div className="grid grid-cols-1">
      <button type="button" onClick={shelf.toggle} aria-expanded={shelf.open} className="mo-row flex h-11 w-full items-center gap-1.5 px-1 text-left [grid-area:1/1]">
        <span className="text-[12px] leading-[1.3] font-medium text-fg-3">{label}</span>
        <span className="text-[12px] leading-[1.3] text-fg-3 tabular-nums">{shelf.count}</span>
        <Icon name="chevronDown" size={14} className={`ml-auto text-fg-3 transition-transform ${shelf.open ? '' : '-rotate-90'}`} />
      </button>
      {shelf.open && fold && fold.trees > 0 && <FoldTrees fold={fold} className="mr-6 h-11 w-11 self-center justify-self-end [grid-area:1/1]" size={16} />}
    </div>
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
