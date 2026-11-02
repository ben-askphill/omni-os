import type { CrewPR, PRSummary, Thread } from '../../../api.ts';
import { plural, relTime } from '../../../format.ts';
import { href } from '../../../router.ts';
import { crewLine, OPEN_PR_PROMPT, prBadge, prLine, type PRNext, type PRTone } from '../../../thread-glance.ts';
import { Button, Chip, Empty, Icon, IconLink, LinkButton, Loading, StatusDot } from '../../ui.tsx';
import { watchCopy, type PRWatchState } from '../PRWatch.tsx';
import type { ThreadPRData } from '../ThreadPR.tsx';

export type ThreadPRs = ThreadPRData | undefined;

const TONE_DOT: Record<PRTone, string> = { live: 'running', done: 'done', needs: 'needs', outline: 'idle' };

/** The step the branch's PR calls for, as one button: a prompt to the agent, or Merge on the PR page. */
export function PRNextButton({ next, thread, pr, busy, onAsk, size = 'sm' }: { next: PRNext; thread: Thread; pr: PRSummary | null; busy: boolean; onAsk: (prompt: string) => void; size?: 'sm' | 'md' }) {
  if (!next) return null;
  if (next.kind === 'merge')
    return pr ? (
      <LinkButton size={size} variant="primary" icon="pr" href={href.pr(thread.channel_id, pr.number)}>
        Merge #{pr.number}
      </LinkButton>
    ) : null;
  return (
    <Button size={size} variant={next.kind === 'open' ? 'primary' : 'secondary'} icon={next.kind === 'open' ? 'pr' : 'zap'} busy={busy} title={next.prompt} onClick={() => onAsk(next.prompt)}>
      {next.label}
    </Button>
  );
}

/**
 * The PRs tab: every PR from the thread's branch with what decides whether it can merge, the step it calls for, and
 * the watch that wakes the thread on a failed check or a review. Opening a PR asks the agent, like it always has. A
 * thread that delegated work lists the PRs its delegated threads opened below, with or without a branch of its own.
 */
export function PRsTab({ thread, data, watch, next, busy, onAsk }: { thread: Thread; data: ThreadPRs; watch: PRWatchState; next: PRNext; busy: boolean; onAsk: (prompt: string) => void }) {
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
      {thread.branch && <BranchPRs thread={thread} data={data} next={next} busy={busy} onAsk={onAsk} />}
      {crew.length > 0 && <CrewPRs crew={crew} first={!thread.branch} />}
      {pr && <WatchCard w={watch} open={open} />}
    </div>
  );
}

function BranchPRs({ thread, data: { pr, prs }, next, busy, onAsk }: { thread: Thread; data: NonNullable<ThreadPRs>; next: PRNext; busy: boolean; onAsk: (prompt: string) => void }) {
  const canOpen = !prs.some((p) => (p.state ?? 'OPEN') === 'OPEN');
  if (prs.length === 0)
    return (
      <div className="rounded-[20px] bg-bg px-4 py-5 text-center">
        <div className="text-[13px] font-medium text-fg">No PR yet</div>
        <p className="mx-auto mt-1 max-w-[260px] text-[12.5px] leading-relaxed text-fg-3">
          Nothing from <span className="font-mono text-[12px]">{thread.branch}</span> has been sent for review.
        </p>
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="primary" icon="pr" busy={busy} title={OPEN_PR_PROMPT} onClick={() => onAsk(OPEN_PR_PROMPT)}>
            Open PR
          </Button>
        </div>
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
      <div className="rounded-[20px] bg-bg p-1">
        {prs.map((p) => {
          const b = prBadge(p);
          const line = prLine(p);
          return (
            <a key={p.number} href={href.pr(thread.channel_id, p.number)} title={p.title} className="hov flex min-w-0 items-start gap-2.5 rounded-[16px] px-3 py-2.5 [--hov:var(--surface)]">
              <span className="w-9 shrink-0 pt-px font-num text-[12.5px] text-fg-3 tabular-nums">#{p.number}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-fg">{p.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-3">
                  <StatusDot status={TONE_DOT[line.tone]} size={6} />
                  <span className="truncate">{line.text}</span>
                </span>
                <span className="flex items-center gap-2 text-[11px] text-fg-4">
                  <span className="font-num text-fg-3">+{p.additions}</span>
                  <span className="font-num">−{p.deletions}</span>
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
          <PRNextButton next={next} thread={thread} pr={pr} busy={busy} onAsk={onAsk} />
          {canOpen && next?.kind !== 'open' && (
            <Button size="sm" variant="ghost" icon="pr" busy={busy} title={OPEN_PR_PROMPT} onClick={() => onAsk(OPEN_PR_PROMPT)}>
              Open a new PR
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
      <div className="rounded-[20px] bg-bg p-1">
        {crew.map((p) => {
          const b = prBadge(p);
          return (
            <div key={p.url} className="flex min-w-0 items-center gap-1 rounded-[16px] pr-1.5">
              <a href={href.pr(p.channel_id, p.number)} title={p.title} className="hov flex min-w-0 flex-1 items-start gap-2.5 rounded-[16px] px-3 py-2.5 [--hov:var(--surface)]">
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
  if (!open && !w.watching) return w.watch ? <p className="mt-4 px-2 text-[11.5px] text-fg-4">{watchCopy(w.watch).line}</p> : null;
  const { action, line } = watchCopy(w.watch);
  return (
    <button
      type="button"
      disabled={w.busy}
      aria-pressed={w.watching}
      onClick={() => void (w.watching ? w.stop() : w.start())}
      className="hov mt-4 flex w-full items-start gap-2.5 rounded-[20px] bg-bg px-3.5 py-3 text-left [--hov:var(--surface-2)] disabled:opacity-60"
    >
      <Icon name="bell" size={14} className={`mt-0.5 shrink-0 ${w.watching ? 'text-live-text' : 'text-fg-3'}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-fg">{action}</span>
        {w.error ? <span className="text-[11.5px] break-words text-needs">{w.error}</span> : <span className="text-[11.5px] leading-snug text-fg-3">{line}</span>}
      </span>
    </button>
  );
}
