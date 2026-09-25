import { useState } from 'react';
import { api, errorText, useApi, type Channel, type Checks, type PRDetail as PRDetailT, type PRSummary, type Thread } from '../api.ts';
import { DiffViewer } from '../components/DiffViewer.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Button, Chip, ConfirmDialog, Empty, ErrorNote, Icon, LinkButton, Loading, Tabs } from '../components/ui.tsx';
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
    <span className="inline-flex items-center gap-2 font-mono text-[12px] tabular-nums" title={`${c.passed} passed, ${c.failed} failed, ${c.pending} pending`}>
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
    <div className="mx-auto max-w-4xl px-4 pt-4 pb-16 md:px-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Tabs tabs={STATES.map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1) }))} value={state} onChange={setState} />
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
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {q.data.map((p) => (
            <a key={p.number} href={href.pr(channel.id, p.number)} className="block px-3.5 py-2.5 transition-colors hover:bg-surface-2">
              <div className="flex min-w-0 items-center gap-2">
                <Icon name="pr" size={14} className={p.isDraft ? 'text-fg-4' : p.state === 'MERGED' ? 'text-info' : p.state === 'CLOSED' ? 'text-bad' : 'text-ok'} />
                <span className="min-w-0 truncate text-[14px] font-medium">{p.title}</span>
                <span className="shrink-0 text-[12.5px] text-fg-4">#{p.number}</span>
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
                <span className="font-mono text-[11.5px]">
                  <span className="text-ok">+{p.additions}</span> <span className="text-bad">-{p.deletions}</span>
                </span>
                <span className="ml-auto">{relTime(p.updatedAt)}</span>
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

export function PRDetail({ channel, n }: { channel: Channel; n: number }) {
  const q = useApi<PRDetailT>(channel.github_repo ? `/channels/${encodeURIComponent(channel.id)}/prs/${n}` : null);
  const [tab, setTab] = useState<DetailTab>('conversation');
  const [method, setMethod] = useState<'squash' | 'merge' | 'rebase'>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  if (!channel.github_repo) return <NoRepo channel={channel} />;
  const back = (
    <a href={href.prs(channel.id)} className="inline-flex items-center gap-1 text-[12.5px] text-fg-3 hover:text-fg">
      <Icon name="chevronLeft" size={13} /> All pull requests
    </a>
  );
  if (q.error && !q.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 pt-4 md:px-8">
        {back}
        <ErrorNote onRetry={q.reload}>{q.error}</ErrorNote>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-4 md:px-8">
        {back}
        <Loading label="Loading pull request" />
      </div>
    );
  }
  const p = q.data;
  const open = !p.state || p.state === 'OPEN';

  const doMerge = async () => {
    setMerging(true);
    setMergeError(null);
    try {
      const r = await api.post<{ ok: boolean; output: string }>(`/channels/${encodeURIComponent(channel.id)}/prs/${n}/merge`, {
        method,
        delete_branch: deleteBranch,
        confirm: true,
      });
      setMerged(r.output?.trim() || 'Merged.');
      setConfirm(false);
      q.reload();
    } catch (e) {
      setMergeError(errorText(e));
    } finally {
      setMerging(false);
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

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-16 md:px-8">
      {back}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-[-0.025em]">
            {p.title} <span className="font-normal text-fg-4">#{p.number}</span>
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
            {p.state && <Chip tone={p.state === 'OPEN' ? 'ok' : p.state === 'MERGED' ? 'info' : 'default'}>{p.state.toLowerCase()}</Chip>}
            {p.isDraft && <Chip tone="outline">Draft</Chip>}
            <ReviewChip d={p.reviewDecision} />
            <span>{p.author?.login}</span>
            <span className="font-mono text-[11.5px]">
              {p.headRefName} <span className="text-fg-4">into</span> {p.baseRefName}
            </span>
            <ChecksSummary c={p.checks} />
            <span className="font-mono text-[11.5px]">
              <span className="text-ok">+{p.additions}</span> <span className="text-bad">-{p.deletions}</span>
            </span>
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
              GitHub <Icon name="external" size={12} />
            </a>
          </div>
        </div>
        <Button icon="layers" onClick={askReview} busy={reviewBusy}>
          Ask builder to review
        </Button>
      </div>
      {reviewError && <ErrorNote className="mt-2">{reviewError}</ErrorNote>}

      {open && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
          <span className="text-[13px] font-medium">Merge</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label="Merge method" className="field !h-8 !w-auto !py-0 text-[13px]">
            <option value="squash">Squash and merge</option>
            <option value="merge">Merge commit</option>
            <option value="rebase">Rebase and merge</option>
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-fg-2">
            <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} className="accent-[var(--fg)]" />
            Delete branch
          </label>
          <div className="ml-auto flex items-center gap-2">
            {p.mergeable === 'CONFLICTING' && <span className="text-[12px] font-medium text-bad">Has conflicts</span>}
            {p.isDraft && <span className="text-[12px] text-warn">Draft</span>}
            {failed > 0 && <span className="text-[12px] text-bad">{failed} checks failing</span>}
            <Button variant="primary" onClick={() => (setMergeError(null), setConfirm(true))} disabled={p.mergeable === 'CONFLICTING'}>
              Merge
            </Button>
          </div>
        </div>
      )}
      {merged && <div className="mt-2 rounded-lg bg-ok-bg px-3 py-2 text-[13px] text-ok whitespace-pre-wrap">{merged}</div>}

      <ConfirmDialog
        open={confirm}
        title="Merge this pull request?"
        confirmLabel={method === 'squash' ? 'Squash and merge' : method === 'rebase' ? 'Rebase and merge' : 'Merge'}
        busy={merging}
        error={mergeError}
        onCancel={() => setConfirm(false)}
        onConfirm={doMerge}
      >
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-fg-3">Repo</dt>
          <dd className="font-mono text-[12.5px] break-all">{channel.github_repo}</dd>
          <dt className="text-fg-3">PR</dt>
          <dd>
            #{p.number} {p.title}
          </dd>
          <dt className="text-fg-3">Method</dt>
          <dd>{method}</dd>
          <dt className="text-fg-3">Branch</dt>
          <dd className="font-mono text-[12.5px] break-all">
            {p.headRefName} into {p.baseRefName}
            {deleteBranch ? ', then deleted' : ''}
          </dd>
        </dl>
        {(failed > 0 || p.isDraft || p.reviewDecision === 'CHANGES_REQUESTED') && (
          <div className="rounded-md bg-warn-bg px-2.5 py-1.5 text-[12.5px] text-warn">
            {[failed > 0 && `${failed} checks failing`, p.isDraft && 'still a draft', p.reviewDecision === 'CHANGES_REQUESTED' && 'changes requested'].filter(Boolean).join(', ')}
          </div>
        )}
        <p className="text-[12.5px] text-fg-3">This runs gh pr merge on GitHub and cannot be undone from here.</p>
      </ConfirmDialog>

      <Tabs
        className="mt-5 border-b border-line pb-2"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'conversation', label: 'Conversation' },
          { id: 'checks', label: 'Checks', badge: <span className="text-[11.5px] text-fg-4">{p.checkRuns.length}</span> },
          { id: 'files', label: 'Files', badge: <span className="text-[11.5px] text-fg-4">{p.files?.length ?? 0}</span> },
          { id: 'diff', label: 'Diff' },
        ]}
      />

      <div className="mt-4">
        {tab === 'conversation' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              {ghBody(p.body) ? <Markdown text={ghBody(p.body)} /> : <div className="text-[13px] text-fg-3">No description.</div>}
            </div>
            {[...(p.reviews ?? []).filter((r) => r.body?.trim() || r.state !== 'COMMENTED').map((r) => ({ kind: 'review' as const, who: r.author?.login, at: r.submittedAt, body: r.body, state: r.state })),
              ...(p.comments ?? []).map((c) => ({ kind: 'comment' as const, who: c.author?.login, at: c.createdAt, body: c.body, state: '' }))]
              .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1))
              .map((c, i) => (
                <div key={i} className="rounded-xl border border-line bg-surface">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[12.5px] text-fg-3">
                    <span className="font-medium text-fg-2">{c.who ?? 'unknown'}</span>
                    {c.kind === 'review' && <Chip tone={c.state === 'APPROVED' ? 'ok' : c.state === 'CHANGES_REQUESTED' ? 'bad' : 'default'}>{c.state.toLowerCase().replace(/_/g, ' ')}</Chip>}
                    {c.at && <span className="ml-auto">{fullDate(c.at)}</span>}
                  </div>
                  {ghBody(c.body) && (
                    <div className="px-4 py-2.5">
                      <Markdown text={ghBody(c.body)} />
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
        {tab === 'checks' &&
          (p.checkRuns.length ? (
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {p.checkRuns.map((c, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3.5 py-2 text-[13px]">
                  <span className={`w-3 font-mono ${checkTone(c.state)}`}>{checkGlyph(c.state)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className={`text-[12px] ${checkTone(c.state)}`}>{c.state.toLowerCase().replace(/_/g, ' ') || 'pending'}</span>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-fg-3 hover:text-fg" aria-label="Open check">
                      <Icon name="external" size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-fg-3">No checks on this PR.</div>
          ))}
        {tab === 'files' && (
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {(p.files ?? []).map((f) => (
              <button
                type="button"
                key={f.path}
                onClick={() => setTab('diff')}
                className="flex w-full min-w-0 items-center gap-2 px-3.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
              >
                <Icon name="file" size={13} className="text-fg-4" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
                <span className="font-mono text-[11.5px] text-ok">+{f.additions}</span>
                <span className="font-mono text-[11.5px] text-bad">-{f.deletions}</span>
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
