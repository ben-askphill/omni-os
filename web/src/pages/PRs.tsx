import { useState, type CSSProperties } from 'react';
import { api, errorText, useApi, type Channel, type Checks, type PRDetail as PRDetailT, type PRSummary, type Thread } from '../api.ts';
import { DiffViewer } from '../components/DiffViewer.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Avatar, Button, Chip, Empty, ErrorNote, Icon, IconLink, LinkButton, Loading, Picker, SlideToConfirm, Tabs, Toggle, type PickerOption } from '../components/ui.tsx';
import { fullDate, relTime } from '../format.ts';
import { href, navigate } from '../router.ts';

/** GitHub hides HTML comments (PR templates, bots); react-markdown would print them. */
const ghBody = (s: string | null | undefined) => (s ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();

function NoRepo({ channel }: { channel: Channel }) {
  return (
    <Empty icon="pr" title="No GitHub repo linked" action={<LinkButton href={href.settings(channel.id)} icon="sliders">Open settings</LinkButton>}>
      Set a local repo path in settings. Omni detects the GitHub repo from it, and builder threads get their own worktree.
    </Empty>
  );
}

export function ChecksSummary({ c }: { c: Checks }) {
  if (!c.passed && !c.failed && !c.pending) return <span className="text-[12px] text-fg-4">no checks</span>;
  return (
    <span className="inline-flex items-center gap-2 font-num text-[11.5px] tabular-nums" title={`${c.passed} passed, ${c.failed} failed, ${c.pending} pending`}>
      {c.passed > 0 && <span className="text-ok">✓ {c.passed}</span>}
      {c.failed > 0 && <span className="text-bad">✗ {c.failed}</span>}
      {c.pending > 0 && <span className="text-warn">• {c.pending}</span>}
    </span>
  );
}

function ReviewChip({ d }: { d: string | null }) {
  if (!d) return null;
  if (d === 'APPROVED') return <Chip tone="ok">Approved</Chip>;
  if (d === 'CHANGES_REQUESTED') return <Chip tone="bad">Changes requested</Chip>;
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
                <Icon name="pr" size={14} className={p.isDraft ? 'text-fg-4' : p.state === 'MERGED' ? 'text-info' : p.state === 'CLOSED' ? 'text-bad' : 'text-ok'} />
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
                  <span className="text-ok">+{p.additions}</span> <span className="text-bad">-{p.deletions}</span>
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

function checkTone(state: string) {
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) return 'text-ok';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state)) return 'text-bad';
  return 'text-warn';
}
function checkGlyph(state: string) {
  const t = checkTone(state);
  return t === 'text-ok' ? '✓' : t === 'text-bad' ? '✗' : '•';
}

type DetailTab = 'conversation' | 'checks' | 'files' | 'diff';
type MergeMethod = 'squash' | 'merge' | 'rebase';

const MERGE_METHODS: PickerOption<MergeMethod>[] = [
  { value: 'squash', label: 'Squash and merge', sub: 'One commit on the base branch', avatar: false },
  { value: 'merge', label: 'Merge commit', sub: 'Keep every commit plus a merge commit', avatar: false },
  { value: 'rebase', label: 'Rebase and merge', sub: 'Replay the commits, no merge commit', avatar: false },
];

export function PRDetail({ channel, n }: { channel: Channel; n: number }) {
  const q = useApi<PRDetailT>(channel.github_repo ? `/channels/${encodeURIComponent(channel.id)}/prs/${n}` : null);
  const [tab, setTab] = useState<DetailTab>('conversation');
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
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
  const open = !p.state || p.state === 'OPEN';

  // Thrown errors spring the slider back; the message stays visible under it.
  const doMerge = async () => {
    setMergeError(null);
    try {
      const r = await api.post<{ ok: boolean; output: string }>(`/channels/${encodeURIComponent(channel.id)}/prs/${n}/merge`, {
        method,
        delete_branch: deleteBranch,
        confirm: true,
      });
      setMerged(r.output?.trim() || 'Merged.');
      q.reload();
    } catch (e) {
      setMergeError(errorText(e));
      throw e;
    }
  };

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

  const failed = p.checkRuns.filter((c) => checkTone(c.state) === 'text-bad').length;
  const warnings = [failed > 0 && `${failed} checks failing`, p.isDraft && 'Still a draft', p.reviewDecision === 'CHANGES_REQUESTED' && 'Changes requested'].filter(Boolean) as string[];
  const conflicting = p.mergeable === 'CONFLICTING';

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 md:px-8">
      {back}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] leading-[1.2]">
            {p.title} <span className="font-num text-[15px] text-fg-4">#{p.number}</span>
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-fg-3">
            {p.state && <Chip tone={p.state === 'OPEN' ? 'ok' : p.state === 'MERGED' ? 'info' : 'default'}>{p.state.toLowerCase()}</Chip>}
            {p.isDraft && <Chip tone="outline">Draft</Chip>}
            <ReviewChip d={p.reviewDecision} />
            <span>{p.author?.login}</span>
            <span className="rounded-full bg-surface-2 px-2 font-mono text-[11px] leading-5">
              {p.headRefName} <span className="text-fg-4">into</span> {p.baseRefName}
            </span>
            <ChecksSummary c={p.checks} />
            <span className="font-num text-[11.5px]">
              <span className="text-ok">+{p.additions}</span> <span className="text-bad">-{p.deletions}</span>
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

      {open && !merged && (
        <section aria-label="Merge" className="mt-5 rounded-[24px] bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[15px]">Merge</span>
            <Picker label="Merge method" value={method} onChange={setMethod} options={MERGE_METHODS} className="ml-1" />
            <label className="flex items-center gap-2 pl-1 text-[13px] text-fg-2">
              <Toggle checked={deleteBranch} onChange={setDeleteBranch} label="Delete branch after merge" />
              Delete branch
            </label>
          </div>
          <div className="mt-2 text-[12.5px] text-fg-3">
            <span className="font-mono text-[11.5px] text-fg-2">{p.headRefName}</span> into <span className="font-mono text-[11.5px] text-fg-2">{p.baseRefName}</span> on{' '}
            <span className="font-mono text-[11.5px] text-fg-2">{channel.github_repo}</span>
            {deleteBranch ? ', then the branch is deleted.' : '.'} Runs gh pr merge and cannot be undone from here.
          </div>
          {(warnings.length > 0 || conflicting) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {conflicting && <Chip tone="bad">Has conflicts</Chip>}
              {warnings.map((w) => (
                <Chip key={w} tone="warn">
                  {w}
                </Chip>
              ))}
            </div>
          )}
          <SlideToConfirm
            className="mt-4"
            label={conflicting ? 'Resolve conflicts first' : `Slide to ${MERGE_METHODS.find((m) => m.value === method)?.label.toLowerCase()}`}
            busyLabel="Merging"
            doneLabel="Merged"
            disabled={conflicting}
            onConfirm={doMerge}
          />
          {mergeError && <ErrorNote className="mt-3">{mergeError}</ErrorNote>}
        </section>
      )}
      {merged && (
        <div className="pop-in mt-5 flex items-start gap-2.5 rounded-[20px] bg-ok-bg px-4 py-3 text-[13px] text-ok">
          <Icon name="check" size={15} strokeWidth={2.25} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{merged}</span>
        </div>
      )}

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

      <div className="mt-4">
        {tab === 'conversation' && (
          <div className="space-y-4">
            <div className="rounded-[20px] bg-surface px-5 py-4">
              {ghBody(p.body) ? <Markdown text={ghBody(p.body)} /> : <div className="text-[13px] text-fg-3">No description.</div>}
            </div>
            {[...(p.reviews ?? []).filter((r) => r.body?.trim() || r.state !== 'COMMENTED').map((r) => ({ kind: 'review' as const, who: r.author?.login, at: r.submittedAt, body: r.body, state: r.state })),
              ...(p.comments ?? []).map((c) => ({ kind: 'comment' as const, who: c.author?.login, at: c.createdAt, body: c.body, state: '' }))]
              .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1))
              .map((c, i) => (
                <div key={i} className="rounded-[20px] bg-surface">
                  <div className="flex items-center gap-2 px-4 pt-3 text-[12.5px] text-fg-3">
                    <Avatar name={c.who ?? '?'} size={22} />
                    <span className="font-medium text-fg-2">{c.who ?? 'unknown'}</span>
                    {c.kind === 'review' && <Chip tone={c.state === 'APPROVED' ? 'ok' : c.state === 'CHANGES_REQUESTED' ? 'bad' : 'default'}>{c.state.toLowerCase().replace(/_/g, ' ')}</Chip>}
                    {c.at && <span className="ml-auto font-num text-[11px] text-fg-4">{fullDate(c.at)}</span>}
                  </div>
                  {ghBody(c.body) && (
                    <div className="px-4 pt-2 pb-3.5">
                      <Markdown text={ghBody(c.body)} />
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
        {tab === 'checks' &&
          (p.checkRuns.length ? (
            <div className="overflow-hidden rounded-[20px] bg-surface p-1.5">
              {p.checkRuns.map((c, i) => (
                <div key={i} className="flex h-10 items-center gap-2.5 rounded-2xl px-3 text-[13px]">
                  <span className={`w-3 font-mono ${checkTone(c.state)}`}>{checkGlyph(c.state)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className={`font-num text-[11px] ${checkTone(c.state)}`}>{c.state.toLowerCase().replace(/_/g, ' ') || 'pending'}</span>
                  {c.url && (
                    <IconLink href={c.url} icon="external" label="Open check" size={13} newTab />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-fg-3">No checks on this PR.</div>
          ))}
        {tab === 'files' && (
          <div className="overflow-hidden rounded-[20px] bg-surface p-1.5">
            {(p.files ?? []).map((f) => (
              <button
                type="button"
                key={f.path}
                onClick={() => setTab('diff')}
                className="hov flex h-9 w-full min-w-0 items-center gap-2 rounded-2xl px-3 text-left text-[12.5px] [--hov:var(--surface-2)]"
              >
                <Icon name="file" size={13} className="text-fg-4" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
                <span className="font-num text-[11px] text-ok">+{f.additions}</span>
                <span className="font-num text-[11px] text-bad">-{f.deletions}</span>
              </button>
            ))}
            {!p.files?.length && <div className="px-3.5 py-2 text-[13px] text-fg-3">No files.</div>}
          </div>
        )}
        {tab === 'diff' && <DiffViewer diff={p.diff ?? ''} />}
      </div>
    </div>
  );
}
