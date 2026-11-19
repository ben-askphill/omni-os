import { useId, useState, type CSSProperties } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type Channel, type Checks, type PRDetail as PRDetailT, type PRSummary } from '../api.ts';
import { Button, Chip, StatusDot, Empty, ErrorNote, Icon, LinkButton, Loading, Tabs, tabPanelProps } from '../components/ui.tsx';
import { pageColumn, PageToolbar, RefreshButton } from '../components/ui/feedback.tsx';
import { prBadge } from '@omni/shared/thread-glance.ts';
import { pullRequestUrl } from '@omni/shared/pr-links.ts';
import { href, navigate } from '../router.ts';
import { DiffStat, PRDetailTabBody, type DetailTab } from './PRDetailTabs.tsx';
import { PRMergePanel } from './PRMergePanel.tsx';
import { LinkChannel } from '../link-previews.ts';
import { useRerunFailedChecks } from '../components/RerunChecks.tsx';

function NoRepo({ channel }: { channel: Channel }) {
  return (
    <Empty icon="pr" title="No GitHub repo linked" action={<LinkButton href={href.settings(channel.id)} icon="sliders">Open settings</LinkButton>}>
      Set a local repo path in settings. Omni detects the GitHub repo from it, and builder threads get their own worktree.
    </Empty>
  );
}

export const hasChecks = (c: Checks) => c.passed + c.failed + c.pending > 0;

export function ChecksSummary({ c }: { c: Checks }) {
  if (!hasChecks(c)) return <span className="text-[12px] text-fg-3">no checks</span>;
  return (
    <span className="inline-flex items-center gap-2 font-num text-[11.5px] tabular-nums" title={`${c.passed} passed, ${c.failed} failed, ${c.pending} pending`}>
      {c.passed > 0 && <span className="inline-flex items-center gap-1 text-fg-2"><StatusDot status="done" size={7} /> {c.passed}</span>}
      {c.failed > 0 && <span className="inline-flex items-center gap-1 text-fg-2"><StatusDot status="needs" size={7} /> {c.failed}</span>}
      {c.pending > 0 && <span className="inline-flex items-center gap-1 text-fg-2"><StatusDot status="running" phase="checking" size={7} /> {c.pending}</span>}
    </span>
  );
}

function ReviewChip({ d }: { d: string | null }) {
  if (!d) return null;
  if (d === 'APPROVED') return <Chip tone="done">Approved</Chip>;
  if (d === 'CHANGES_REQUESTED') return <Chip tone="needs">Changes requested</Chip>;
  if (d === 'REVIEW_REQUIRED') return <Chip>Review required</Chip>;
  return <Chip>{d.toLowerCase().replace(/_/g, ' ')}</Chip>;
}

const STATES = ['open', 'merged', 'closed', 'all'] as const;
type PRState = (typeof STATES)[number];

export function PRList({ channel }: { channel: Channel }) {
  const [state, setState] = useState<PRState>('open');
  const q = useApi<PRSummary[]>(channel.github_repo ? `/channels/${encodeURIComponent(channel.id)}/prs?state=${state}` : null);

  if (!channel.github_repo) return <NoRepo channel={channel} />;
  const noRepo = q.error && /no github repo/i.test(q.error);

  return (
    <div className={`${pageColumn('measure')} pt-6 pb-16`}>
      <PageToolbar
        className="mb-3"
        right={
          <>
            <LinkButton size="sm" variant="ghost" icon="external" href={`https://github.com/${channel.github_repo}/pulls`} target="_blank">
              GitHub
            </LinkButton>
            <RefreshButton onClick={q.reload} busy={q.loading && !!q.data} label="Refresh pull requests" />
          </>
        }
      >
        <Tabs size="sm" label="Pull request state" tabs={STATES.map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1) }))} value={state} onChange={setState} />
      </PageToolbar>
      {noRepo ? (
        <NoRepo channel={channel} />
      ) : q.error ? (
        <ErrorNote onRetry={q.reload}>{q.error}</ErrorNote>
      ) : !q.data ? (
        <Loading label="Asking GitHub" />
      ) : !q.data.length ? (
        <Empty icon="pr" title={`No ${state === 'all' ? '' : state + ' '}pull requests`}>
          {channel.github_repo}
        </Empty>
      ) : (
        <div className="rise">
          {q.data.map((p, i) => (
            <a key={p.number} href={href.pr(channel.id, p.number)} style={{ '--i': i } as CSSProperties} className="hov block rounded-[var(--r-lg)] px-3.5 py-3 [--hov:var(--surface)]">
              <div className="flex min-w-0 items-center gap-2">
                <Icon name="pr" size={14} className={p.state === 'MERGED' ? 'text-fg-2' : 'text-fg-3'} />
                <span className="min-w-0 truncate text-[length:var(--fs-body)] font-medium">{p.title}</span>
                <span className="shrink-0 font-num text-[length:var(--fs-code)] text-fg-3">#{p.number}</span>
                {p.isDraft && <Chip tone="outline">Draft</Chip>}
                <ReviewChip d={p.reviewDecision} />
                <span className="ml-auto shrink-0">
                  <ChecksSummary c={p.checks} />
                </span>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] text-[12px] text-fg-3">
                <span>{p.author?.login ?? 'unknown'}</span>
                <span className="min-w-0 truncate font-mono text-[11.5px]">
                  {p.headRefName} <span className="text-fg-3">into</span> {p.baseRefName}
                </span>
                <DiffStat additions={p.additions} deletions={p.deletions} />
                <span className="ml-auto font-num text-[11px] text-fg-3">{relTime(p.updatedAt)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Files the PR changes: the larger of the diff's count and gh's file list. The list stops at 100 files; the diff stops at
 * 400,000 characters, so either can come up short.
 */
const changedFiles = (p: PRDetailT) => Math.max(p.diff?.match(/^diff --git /gm)?.length ?? 0, p.files?.length ?? 0);

/** Where the PR came from: the thread that delegated the work, then the thread that opened the PR. */
function PRThreadLinks({ thread }: { thread: NonNullable<PRDetailT['thread']> }) {
  const link = 'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--r-xs)] py-1 text-fg-2 underline decoration-[var(--line-strong)] underline-offset-[3px] transition-colors hover:text-fg hover:decoration-current';
  return (
    <nav aria-label="Threads" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[length:var(--fs-small)] text-fg-3">
      <span>From</span>
      {thread.parent && (
        <>
          <a href={href.thread(thread.parent.id)} className={link} title={`The thread that delegated this work: ${thread.parent.title}`}>
            <Icon name="arrowUpRight" size={12} className="shrink-0 text-fg-3" />
            <span className="truncate">{thread.parent.title || 'Parent thread'}</span>
          </a>
        </>
      )}
      {/* The separator wraps with the link after it, so a wrapped line never ends on it. */}
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
        {thread.parent && <Icon name="chevronRight" size={11} className="shrink-0 text-fg-3" />}
        <a href={href.thread(thread.id)} className={link} title={`The thread that opened this PR: ${thread.title}`}>
          <Icon name="message" size={12} className="shrink-0 text-fg-3" />
          <span className="truncate">{thread.title || (thread.parent ? 'Delegated thread' : 'Open thread')}</span>
        </a>
      </span>
    </nav>
  );
}

export function PRDetail({ channel, n }: { channel: Channel; n: number }) {
  const q = useApi<PRDetailT>(channel.github_repo ? `/channels/${encodeURIComponent(channel.id)}/prs/${n}` : null);
  const [tab, setTab] = useState<DetailTab>('conversation');
  const panel = useId();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const rerun = useRerunFailedChecks(channel.id, n, q.data?.checkRuns, !q.data?.state || q.data.state === 'OPEN');

  if (!channel.github_repo) return <NoRepo channel={channel} />;
  const back = (
    <a href={href.prs(channel.id)} className="hov -ml-2.5 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-fg-3 hover:text-fg">
      <Icon name="chevronLeft" size={13} /> All pull requests
    </a>
  );
  if (q.error && !q.data) {
    // A PR link brings Ben here instead of GitHub (pr-links.ts), so when gh cannot answer, GitHub is one click away.
    return (
      <div className={`${pageColumn('page')} space-y-3 pt-6`}>
        {back}
        <ErrorNote onRetry={q.reload}>{q.error}</ErrorNote>
        <LinkButton size="sm" variant="ghost" icon="external" href={pullRequestUrl(channel.github_repo, n)} target="_blank" external>
          Open on GitHub
        </LinkButton>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className={`${pageColumn('page')} pt-6`}>
        {back}
        <Loading label="Loading pull request" />
      </div>
    );
  }
  const p = q.data;
  const badge = prBadge(p);

  const askReview = async () => {
    setReviewBusy(true);
    setReviewError(null);
    try {
      const result = await api.post<{ destination_thread_id: string }>(`/channels/${encodeURIComponent(channel.id)}/prs/${n}/review`, {});
      navigate(`/t/${result.destination_thread_id}`);
    } catch (e) {
      setReviewError(errorText(e));
      setReviewBusy(false);
    }
  };

  return (
    <div className={`${pageColumn('page')} pt-6 pb-16`}>
      {/* The page's actions ride on the back link's row, so the title gets the full width. */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        {back}
        <div className="flex shrink-0 items-center gap-1.5">
          <LinkButton size="sm" variant="ghost" icon="external" href={p.url} target="_blank" external>
            <span className="max-sm:sr-only">GitHub</span>
          </LinkButton>
          <Button size="sm" icon="delegate" onClick={askReview} busy={reviewBusy}>
            Ask builder to review
          </Button>
        </div>
      </div>
      <header className="mt-3">
        <h2 className="font-display text-[length:var(--fs-title)] leading-[1.15] text-balance">
          {p.title} <span className="font-num whitespace-nowrap text-fg-3">#{p.number}</span>
        </h2>
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--fs-small)] text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <Chip tone={badge.tone}>{badge.label}</Chip>
            <ReviewChip d={p.reviewDecision} />
          </span>
          {p.author?.login && <span>{p.author.login}</span>}
          <span className="min-w-0 truncate font-mono text-[length:var(--fs-code)]" title={`${p.headRefName} into ${p.baseRefName}`}>
            {p.headRefName} <span className="text-fg-3">→</span> {p.baseRefName}
          </span>
          {hasChecks(p.checks) && <ChecksSummary c={p.checks} />}
          <DiffStat additions={p.additions} deletions={p.deletions} />
        </div>
        {p.thread && <PRThreadLinks thread={p.thread} />}
      </header>
      {reviewError && <ErrorNote className="mt-3">{reviewError}</ErrorNote>}

      <PRMergePanel channel={channel} p={p} n={n} onMerged={q.reload} rerun={rerun} />
      <Tabs
        className="mt-6"
        size="sm"
        kind="tabs"
        panel={panel}
        label="Pull request"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'conversation', label: 'Conversation' },
          { id: 'checks', label: 'Checks', badge: <span className="font-num text-[10.5px] text-fg-3">{p.checkRuns.length}</span> },
          { id: 'changes', label: 'Changes', badge: <span className="font-num text-[10.5px] text-fg-3">{changedFiles(p)}</span> },
        ]}
      />

      <LinkChannel.Provider value={channel.id}>
        <div className="mt-4" {...tabPanelProps(panel, tab)}>
          <PRDetailTabBody tab={tab} p={p} />
        </div>
      </LinkChannel.Provider>
    </div>
  );
}
