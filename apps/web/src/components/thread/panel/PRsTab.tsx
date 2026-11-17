import { useEffect, useId, useState } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, type CrewPR, type PRSummary, type Thread } from '../../../api.ts';
import { plural } from '../../../format.ts';
import { href } from '../../../router.ts';
import { crewLine, OPEN_PR_PROMPT, prBadge, prLine, STEP_WORKING, stepParkedText, type PRNext, type PRStep, type PRTone } from '@omni/shared/thread-glance.ts';
import { Button, Chip, Empty, ErrorNote, Icon, IconLink, Loading, StatusDot } from '../../ui.tsx';
import { useToast } from '../../Toaster.tsx';
import { watchCopy } from '@omni/shared/pr-watch.ts';
import type { PRWatchState } from '../PRWatch.tsx';
import type { ThreadPRData } from '../ThreadPR.tsx';

export type ThreadPRs = ThreadPRData | undefined;

const TONE_DOT: Record<PRTone, string> = { live: 'running', done: 'done', needs: 'needs', outline: 'idle' };

/**
 * One PR's merge from the panel: squash, then delete the branch (the phone PR screen's defaults), then read the PRs again.
 * The PR page keeps the other merge methods. Merge only opens the confirm (`asking`); Squash and merge in it runs gh. A
 * refusal from gh stays in the confirm so it can be read and tried again.
 */
export function useMerge(channelId: string, number: number, onMerged: () => void) {
  const toast = useToast();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { trigger: `${id}merge`, confirm: `${id}confirm`, note: `${id}note`, cancel: `${id}cancel` };
  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/channels/${encodeURIComponent(channelId)}/prs/${number}/merge`, { method: 'squash', delete_branch: true, confirm: true });
      toast({ title: `Merged #${number}`, icon: 'pr' });
      setAsking(false);
      onMerged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setAsking(false);
    setError(null);
  };
  return { number, ids, asking, busy, error, merge, close, toggle: () => (asking ? close() : setAsking(true)) };
}

export type MergeState = ReturnType<typeof useMerge>;

/**
 * Merge on a PR's row: small, and the one filled button only on a PR that can merge. It opens the confirm under the row
 * rather than merging, and turns quiet while that is open so the confirm holds the one filled button.
 */
export function MergeTrigger({ m, label = 'Merge' }: { m: MergeState; label?: string }) {
  return (
    <Button
      size="sm"
      id={m.ids.trigger}
      variant={m.asking ? 'secondary' : 'primary'}
      icon="pr"
      aria-label={label === 'Merge' ? `Merge #${m.number}` : undefined}
      aria-expanded={m.asking}
      aria-controls={m.ids.confirm}
      disabled={m.busy}
      title="Squash and merge, then delete the branch"
      onClick={m.toggle}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && m.asking) {
          e.stopPropagation();
          m.close();
        }
      }}
    >
      {label}
    </Button>
  );
}

/**
 * The confirm under a PR's row: what the merge does, Cancel (focused, so a second Enter does not merge) and Squash and
 * merge. It opens below the row, so a double click on Merge cannot land on it. Escape closes it.
 */
export function MergeConfirm({ m, base, onPanel = false, className = '' }: { m: MergeState; base?: string | null; /** On the panel's own background, not in a card: it takes the card fill. */ onPanel?: boolean; className?: string }) {
  useEffect(() => {
    if (m.asking) document.getElementById(m.ids.cancel)?.focus();
  }, [m.asking, m.ids.cancel]);
  if (!m.asking) return null;
  const close = () => {
    m.close();
    document.getElementById(m.ids.trigger)?.focus();
  };
  return (
    <div
      id={m.ids.confirm}
      role="group"
      aria-label={`Merge #${m.number}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !m.busy) {
          e.stopPropagation();
          close();
        }
      }}
      className={`pop-in rounded-[var(--r-lg)] ${onPanel ? 'bg-bg' : 'bg-surface'} px-[var(--sp-6)] py-[var(--sp-5)] ${className}`}
    >
      <p id={m.ids.note} className="text-[12px] leading-[1.45] text-fg-2">
        Squash-merges #{m.number}
        {base ? (
          <>
            {' '}
            into <span className="font-mono text-[11.5px]">{base}</span>
          </>
        ) : null}
        , then deletes its branch. Can’t be undone from here.
      </p>
      {m.error && (
        <p role="alert" className="mt-[var(--sp-4)] flex items-start gap-[var(--sp-4)] text-[12px] leading-[1.45] break-words text-fg">
          <StatusDot status="needs" size={7} className="mt-[5px] shrink-0" />
          <span className="min-w-0">{m.error}</span>
        </p>
      )}
      <div className="mt-[var(--sp-5)] flex flex-wrap justify-end gap-[var(--sp-3)]">
        <Button size="sm" variant="ghost" id={m.ids.cancel} disabled={m.busy} onClick={close}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon="pr" busy={m.busy} aria-describedby={m.ids.note} onClick={() => void m.merge()}>
          {m.busy ? 'Merging…' : 'Squash and merge'}
        </Button>
      </div>
    </div>
  );
}

/** Merge with its confirm under it, for a wrapping row of buttons (the PRs tab): the confirm takes a line of its own. */
function MergeAction({ channelId, number, base, onMerged }: { channelId: string; number: number; base?: string | null; onMerged: () => void }) {
  const m = useMerge(channelId, number, onMerged);
  return (
    <>
      <MergeTrigger m={m} label={`Merge #${number}`} />
      <MergeConfirm m={m} base={base} onPanel className="w-full" />
    </>
  );
}

/**
 * A step that asks the agent (Open PR, Fix conflicts, Fix checks). While the agent works on a step the button spins and
 * says so, and every step button waits for it.
 */
export function StepButton({ next, step, onAsk }: { next: Exclude<PRNext, null | { kind: 'merge' }>; step: PRStep | null; onAsk: (prompt: string) => void }) {
  return (
    <Button size="sm" variant={next.kind === 'open' ? 'primary' : 'secondary'} icon={next.kind === 'open' ? 'pr' : 'zap'} busy={step === next.kind} disabled={step !== null} onClick={() => onAsk(next.prompt)}>
      {step === next.kind ? `${STEP_WORKING[step]}…` : next.label}
    </Button>
  );
}

/**
 * The step the branch's PR calls for, as one button: a prompt to the agent, or a merge behind its confirm. A step whose
 * message was parked (`parked`) says why it did not start under the button.
 */
function PRNextButton({ next, thread, pr, step, parked = null, onAsk, onMerged }: { next: PRNext; thread: Thread; pr: PRSummary | null; step: PRStep | null; parked?: PRStep | null; onAsk: (prompt: string) => void; onMerged: () => void }) {
  if (!next) return null;
  if (next.kind === 'merge') return pr ? <MergeAction channelId={thread.channel_id} number={pr.number} base={pr.baseRefName} onMerged={onMerged} /> : null;
  return (
    <>
      <StepButton next={next} step={step} onAsk={onAsk} />
      {step === null && parked === next.kind && <ErrorNote className="w-full">{stepParkedText(parked, thread)}</ErrorNote>}
    </>
  );
}

/**
 * The PRs tab: every PR from the thread's branch with what decides whether it can merge, the step it calls for, and
 * the watch that wakes the thread on a failed check or a review. Opening a PR asks the agent, like it always has. A
 * thread that delegated work lists the PRs its delegated threads opened below, with or without a branch of its own.
 */
export function PRsTab({ thread, data, watch, next, step, parked = null, openPrompt = OPEN_PR_PROMPT, onAsk, onMerged = () => {} }: { thread: Thread; data: ThreadPRs; watch: PRWatchState; next: PRNext; step: PRStep | null; parked?: PRStep | null; /** The channel's Open PR prompt (`stepPrompts`). */ openPrompt?: string; onAsk: (prompt: string) => void; onMerged?: () => void }) {
  if (!data) return <Loading label="Loading PRs" />;
  const { pr, crew } = data;
  if (!thread.branch && !crew.length)
    return (
      <Empty icon="pr" title="No branch">
        This thread works in the channel folder, not on a branch of its own, so it has no PRs.
      </Empty>
    );
  const open = (pr?.state ?? 'OPEN') === 'OPEN';
  return (
    <div className="scroll-thin h-full overflow-y-auto px-2.5 pb-3">
      {thread.branch && <BranchPRs thread={thread} data={data} next={next} step={step} parked={parked} openPrompt={openPrompt} onAsk={onAsk} onMerged={onMerged} />}
      {crew.length > 0 && <CrewPRs crew={crew} first={!thread.branch} />}
      {pr && <WatchCard w={watch} open={open} />}
    </div>
  );
}

function BranchPRs({ thread, data: { pr, prs }, next, step, parked, openPrompt, onAsk, onMerged }: { thread: Thread; data: NonNullable<ThreadPRs>; next: PRNext; step: PRStep | null; parked: PRStep | null; openPrompt: string; onAsk: (prompt: string) => void; onMerged: () => void }) {
  const canOpen = !prs.some((p) => (p.state ?? 'OPEN') === 'OPEN');
  const opening = step === 'open';
  if (prs.length === 0)
    return (
      <div className="rounded-[var(--r-xl)] bg-bg px-4 py-5 text-center" aria-live="polite">
        <div className="text-[13px] font-medium text-fg">{opening ? `${STEP_WORKING.open}…` : 'No PR yet'}</div>
        <p className="mx-auto mt-1 min-h-[2lh] max-w-[260px] text-[12.5px] leading-relaxed text-fg-3">
          {opening ? (
            <>
              The agent is pushing <span className="font-mono text-[12px]">{thread.branch}</span>. The PR shows up here.
            </>
          ) : (
            <>
              Nothing from <span className="font-mono text-[12px]">{thread.branch}</span> has been sent for review.
            </>
          )}
        </p>
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="primary" icon="pr" busy={opening} disabled={step !== null} onClick={() => onAsk(openPrompt)}>
            {opening ? STEP_WORKING.open : 'Open PR'}
          </Button>
        </div>
        {step === null && parked === 'open' && <ErrorNote className="mt-3 text-left">{stepParkedText('open', thread)}</ErrorNote>}
      </div>
    );
  return (
    <>
      <div className="mb-1.5 flex items-center px-2">
        <span className="caption">Pull requests</span>
        <span className="ml-auto truncate pl-2 text-[11px] text-fg-3">
          {plural(prs.length, 'PR')} from <span className="font-mono">{thread.branch}</span>
        </span>
      </div>
      <div className="rounded-[var(--r-xl)] bg-bg p-1">
        {prs.map((p) => {
          const b = prBadge(p);
          const line = prLine(p);
          return (
            <a key={p.number} href={href.pr(thread.channel_id, p.number)} title={p.title} className="hov flex min-w-0 items-start gap-2.5 rounded-[var(--r-lg)] px-3 py-2.5 [--hov:var(--surface)]">
              <span className="w-9 shrink-0 pt-px font-num text-[12.5px] text-fg-3 tabular-nums">#{p.number}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-fg">{p.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-3">
                  <StatusDot status={TONE_DOT[line.tone]} phase={line.tone === 'live' ? 'checking' : null} size={6} />
                  <span className="truncate">{line.text}</span>
                </span>
                <span className="flex items-center gap-2 text-[11px] text-fg-3">
                  <span className="font-num text-[color:var(--diff-add-fg)]">+{p.additions}</span>
                  <span className="font-num text-[color:var(--diff-del-fg)]">−{p.deletions}</span>
                  <span>{relTime(p.updatedAt)}</span>
                </span>
              </span>
              <Chip tone={b.tone}>{b.label}</Chip>
            </a>
          );
        })}
      </div>
      {(next || canOpen) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 px-1">
          <PRNextButton next={next} thread={thread} pr={pr} step={step} parked={parked} onAsk={onAsk} onMerged={onMerged} />
          {canOpen && next?.kind !== 'open' && (
            <Button size="sm" variant="ghost" icon="pr" busy={opening} disabled={step !== null} onClick={() => onAsk(openPrompt)}>
              {opening ? `${STEP_WORKING.open}…` : 'Open a new PR'}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/** The PRs the threads this one delegated to opened. A row opens the PR, and the link beside it opens the thread behind it. */
export function CrewPRs({ crew, first }: { crew: CrewPR[]; first: boolean }) {
  return (
    <section aria-label="From delegated threads" className={first ? '' : 'mt-4'}>
      <div className="mb-1.5 flex items-center px-2">
        <span className="caption">From delegated threads</span>
        <span className="ml-auto truncate pl-2 text-[11px] text-fg-3">{crewLine(crew).text}</span>
      </div>
      <div className="rounded-[var(--r-xl)] bg-bg p-1">
        {crew.map((p) => {
          const b = prBadge(p);
          return (
            <div key={p.url} className="flex min-w-0 items-center gap-1 rounded-[var(--r-lg)] pr-1.5">
              <a href={href.pr(p.channel_id, p.number)} title={p.title} className="hov flex min-w-0 flex-1 items-start gap-2.5 rounded-[var(--r-lg)] px-3 py-2.5 [--hov:var(--surface)]">
                <span className="w-9 shrink-0 pt-px font-num text-[12.5px] text-fg-3 tabular-nums">#{p.number}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-fg">{p.title}</span>
                  <span className="truncate text-[11.5px] text-fg-3">{[p.task_id, p.thread_title].filter(Boolean).join(' · ')}</span>
                </span>
                <Chip tone={b.tone}>{b.label}</Chip>
              </a>
              <IconLink href={href.thread(p.thread_id)} icon="message" label={`Open thread: ${p.thread_title}`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Start or stop the PR watch, over its status line. A watch that ended with its PR keeps its line, without the toggle. */
function WatchCard({ w, open }: { w: PRWatchState; open: boolean }) {
  if (!open && !w.watching) return w.watch ? <p className="mt-4 px-2 text-[11.5px] text-fg-3">{watchCopy(w.watch).line}</p> : null;
  const { action, line } = watchCopy(w.watch);
  return (
    <button
      type="button"
      disabled={w.busy}
      aria-pressed={w.watching}
      onClick={() => void (w.watching ? w.stop() : w.start())}
      className="hov mt-4 flex w-full items-start gap-2.5 rounded-[var(--r-xl)] bg-bg px-3.5 py-3 text-left [--hov:var(--surface-2)] disabled:opacity-60"
    >
      <Icon name="bell" size={14} className={`mt-0.5 shrink-0 ${w.watching ? 'text-live-text' : 'text-fg-3'}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-fg">{action}</span>
        {w.error ? <span className="text-[11.5px] break-words text-needs">{w.error}</span> : <span className="text-[11.5px] leading-snug text-fg-3">{line}</span>}
      </span>
    </button>
  );
}
