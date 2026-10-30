import { useState, type CSSProperties } from 'react';
import { api, errorText, useApi, type Channel, type Checks, type PRDetail as PRDetailT, type PRSummary, type Thread } from '../api.ts';
import { Button, Chip, StatusDot, Empty, ErrorNote, Icon, IconLink, LinkButton, Loading, Tabs } from '../components/ui.tsx';
import { relTime } from '../format.ts';
import { href, navigate } from '../router.ts';
import { PRDetailTabBody, type DetailTab } from './PRDetailTabs.tsx';
import { PRMergePanel } from './PRMergePanel.tsx';
import { LinkChannel } from '../link-previews.ts';

function NoRepo({ channel }: { channel: Channel }) {
  return (
    <Empty icon="pr" title="No GitHub repo linked" action={<LinkButton href={href.settings(channel.id)} icon="sliders">Open settings</LinkButton>}>
      Set a local repo path in settings. Omni detects the GitHub repo from it, and builder threads get their own worktree.
    </Empty>
  );
}

export { checkTone } from './PRDetailTabs.tsx';

export function ChecksSummary({ c }: { c: Checks }) {
  if (!c.passed && !c.failed && !c.pending) return <span className="text-[12px] text-fg-4">no checks</span>;
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
    <div className="mx-auto max-w-4xl px-4 pt-6 pb-16 md:px-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Tabs size="sm" tabs={STATES.map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1) }))} value={state} onChange={setState} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon="refresh" onClick={q.reload} busy={q.loading && !!q.data}>
            Refresh
          </Button>
          <LinkButton size="sm" variant="ghost" icon="external" href={`https://github.com/${channel.github_repo}/pulls`} target="_blank">
            GitHub
          </LinkButton>
        </div>
      </div>
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
            <a key={p.number} href={href.pr(channel.id, p.number)} style={{ '--i': i } as CSSProperties} className="hov block rounded-[18px] px-3.5 py-3 [--hov:var(--surface)]">
              <div className="flex min-w-0 items-center gap-2">
                <Icon name="pr" size={14} className={p.isDraft || p.state === 'CLOSED' ? 'text-fg-4' : p.state === 'MERGED' ? 'text-fg-2' : 'text-live-text'} />
                <span className="min-w-0 truncate text-[14px] font-medium">{p.title}</span>
                <span className="shrink-0 font-num text-[11.5px] text-fg-4">#{p.number}</span>
                {p.isDraft && <Chip tone="outline">Draft</Chip>}
                <ReviewChip d={p.reviewDecision} />
                <span className="ml-auto shrink-0">
                  <ChecksSummary c={p.checks} />
                </span>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] text-[12px] text-fg-3">
                <span>{p.author?.login ?? 'unknown'}</span>
                <span className="min-w-0 truncate font-mono text-[11.5px]">
                  {p.headRefName} <span className="text-fg-4">into</span> {p.baseRefName}
                </span>
                <span className="font-num text-[11px]">
                  <span className="text-fg-2">+{p.additions}</span> <span className="text-fg-3">-{p.deletions}</span>
                </span>
                <span className="ml-auto font-num text-[11px] text-fg-4">{relTime(p.updatedAt)}</span>
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

  if (!channel.github_repo) return <NoRepo channel={channel} />;
  const back = (
    <a href={href.prs(channel.id)} className="hov -ml-2.5 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-fg-3 hover:text-fg">
      <Icon name="chevronLeft" size={13} /> All pull requests
    </a>
  );
  if (q.error && !q.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 pt-6 md:px-8">
        {back}
        <ErrorNote onRetry={q.reload}>{q.error}</ErrorNote>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-6 md:px-8">
        {back}
        <Loading label="Loading pull request" />
      </div>
    );
  }
  const p = q.data;

  const askReview = async () => {
    setReviewBusy(true);
    setReviewError(null);
    try {
      const t = await api.post<Thread>('/threads', {
        channel: channel.id,
        role: 'builder',
        prompt: `Review PR #${p.number} in ${channel.github_repo}: summarize the change, risks, and anything that should block merge.`,
      });
      navigate(`/t/${t.id}`);
    } catch (e) {
      setReviewError(errorText(e));
      setReviewBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 md:px-8">
      {back}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] leading-[1.2]">
            {p.title} <span className="font-num text-[15px] text-fg-4">#{p.number}</span>
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-fg-3">
            {p.state && <Chip tone={p.state === 'OPEN' ? 'live' : p.state === 'MERGED' ? 'done' : 'outline'}>{p.state.toLowerCase()}</Chip>}
            {p.isDraft && <Chip tone="outline">Draft</Chip>}
            <ReviewChip d={p.reviewDecision} />
            <span>{p.author?.login}</span>
            <span className="rounded-full bg-surface-2 px-2 font-mono text-[11px] leading-5">
              {p.headRefName} <span className="text-fg-4">into</span> {p.baseRefName}
            </span>
            <ChecksSummary c={p.checks} />
            <span className="font-num text-[11.5px]">
              <span className="text-fg-2">+{p.additions}</span> <span className="text-fg-3">-{p.deletions}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <IconLink href={p.url} icon="external" label="Open on GitHub" newTab />
          <Button icon="layers" onClick={askReview} busy={reviewBusy}>
            Ask builder to review
          </Button>
        </div>
      </div>
      {reviewError && <ErrorNote className="mt-2">{reviewError}</ErrorNote>}

      <PRMergePanel channel={channel} p={p} n={n} onMerged={q.reload} />
      <Tabs
        className="mt-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'conversation', label: 'Conversation' },
          { id: 'checks', label: 'Checks', badge: <span className="font-num text-[10.5px] text-fg-4">{p.checkRuns.length}</span> },
          { id: 'files', label: 'Files', badge: <span className="font-num text-[10.5px] text-fg-4">{p.files?.length ?? 0}</span> },
          { id: 'diff', label: 'Diff' },
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
