import { useState, type CSSProperties } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type Channel, type Checks, type PRDetail as PRDetailT, type PRSummary } from '../api.ts';
import { Button, Chip, StatusDot, Empty, ErrorNote, Icon, LinkButton, Loading, Tabs } from '../components/ui.tsx';
import { pageColumn, PageToolbar, RefreshButton } from '../components/ui/feedback.tsx';
import { prBadge } from '@omni/shared/thread-glance.ts';
import { href, navigate } from '../router.ts';
import { DiffStat, PRDetailTabBody, type DetailTab } from './PRDetailTabs.tsx';
import { PRMergePanel } from './PRMergePanel.tsx';
import { LinkChannel } from '../link-previews.ts';
import { RerunNote, useRerunFailedChecks } from '../components/RerunChecks.tsx';

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
      {c.pending > 0 && <span className="inline-flex items-center gap-1 text-live-text"><StatusDot status="running" size={7} /> {c.pending}</span>}
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
        <Tabs size="sm" tabs={STATES.map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1) }))} value={state} onChange={setState} />
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

export function PRDetail({ channel, n }: { channel: Channel; n: number }) {
  const q = useApi<PRDetailT>(channel.github_repo ? `/channels/${encodeURIComponent(channel.id)}/prs/${n}` : null);
  const [tab, setTab] = useState<DetailTab>('conversation');
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
    return (
      <div className={`${pageColumn('page')} space-y-3 pt-6`}>
        {back}
        <ErrorNote onRetry={q.reload}>{q.error}</ErrorNote>
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
      {back}
      {/* The actions sit beside the title when the page is wide enough, else after the related threads, review first. */}
      <div className="@container mt-3">
        <header className="grid grid-cols-1 gap-y-2.5 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:gap-x-6">
          <h2 className="font-display text-[length:var(--fs-title)] leading-[1.15] text-balance @3xl:col-start-1 @3xl:row-start-1">
            {p.title} <span className="font-num whitespace-nowrap text-fg-3">#{p.number}</span>
          </h2>
          <div className="order-last flex flex-row-reverse items-center justify-end gap-1.5 @3xl:order-none @3xl:col-start-2 @3xl:row-start-1 @3xl:flex-row @3xl:self-start">
            <LinkButton size="sm" variant="ghost" icon="external" href={p.url} target="_blank">
              GitHub
            </LinkButton>
            {rerun.can && (
              <Button size="sm" icon="refresh" onClick={() => void rerun.run()} busy={rerun.busy} title="Runs gh run rerun --failed for each failing workflow run. No agent turn.">
                Rerun failed checks
              </Button>
            )}
            <Button size="sm" icon="delegate" onClick={askReview} busy={reviewBusy}>
              Ask builder to review
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--fs-small)] text-fg-3 @3xl:col-span-2">
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
          {p.thread && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 @3xl:col-span-2">
              {p.thread.parent && (
                <LinkButton size="sm" href={href.thread(p.thread.parent.id)} icon="arrowUpRight" className="max-w-full min-w-0">
                  <span className="truncate" title={`The thread that delegated this work: ${p.thread.parent.title}`}>
                    {p.thread.parent.title || 'Parent thread'}
                  </span>
                </LinkButton>
              )}
              <LinkButton size="sm" href={href.thread(p.thread.id)} icon="message" className="max-w-full min-w-0">
                <span className="truncate" title={`The thread that opened this PR: ${p.thread.title}`}>
                  {p.thread.parent ? 'Delegated thread' : p.thread.title || 'Open thread'}
                </span>
              </LinkButton>
            </div>
          )}
        </header>
      </div>
      {reviewError && <ErrorNote className="mt-2">{reviewError}</ErrorNote>}
      <RerunNote outcome={rerun.outcome} className="mt-3" />

      <PRMergePanel channel={channel} p={p} n={n} onMerged={q.reload} />
      <Tabs
        className="mt-6"
        size="sm"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'conversation', label: 'Conversation' },
          { id: 'checks', label: 'Checks', badge: <span className="font-num text-[10.5px] text-fg-3">{p.checkRuns.length}</span> },
          { id: 'files', label: 'Files', badge: <span className="font-num text-[10.5px] text-fg-3">{p.files?.length ?? 0}</span> },
          { id: 'diff', label: 'Diff', badge: <span className="font-num text-[10.5px] text-fg-3">+{p.additions} −{p.deletions}</span> },
        ]}
      />

      <LinkChannel.Provider value={channel.id}>
        <div className="mt-4">
          <PRDetailTabBody tab={tab} p={p} onFiles={() => setTab('diff')} />
        </div>
      </LinkChannel.Provider>
    </div>
  );
}
