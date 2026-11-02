import { useState, type CSSProperties } from 'react';
import { relTime } from '@omni/shared/format.ts';
import { DEFAULT_PR_QUERY, isNarrowed, queryPRs, type PRQuery } from '@omni/shared/pr-query.ts';
import { prBadge } from '@omni/shared/thread-glance.ts';
import { useApi, type AllPRs, type Async, type ListedPR } from '../api.ts';
import { Button, Chip, Empty, ErrorNote, Icon, Loading, PageHeader } from '../components/ui.tsx';
import { ChecksSummary } from './PRs.tsx';
import { PRGroupHead, PRToolbar, type SetPRQuery } from './PRToolbar.tsx';

export const useAllPRs = () => useApi<AllPRs>('/prs');

/** What the list shows in place of rows: why it is empty, or null when it has rows. */
export function allPRsEmpty(q: Async<AllPRs>): { kind: 'loading' | 'error' | 'empty'; text: string } | null {
  if (q.error) return { kind: 'error', text: q.error };
  if (!q.data) return { kind: 'loading', text: 'Asking GitHub' };
  const { repos, prs, failed } = q.data;
  if (prs.length) return null;
  if (!repos.length) return { kind: 'empty', text: 'No channel has a GitHub repo. Set a repo path in a channel’s settings and its PRs show here.' };
  if (failed.length === repos.length) return { kind: 'error', text: failedText(failed) };
  return { kind: 'empty', text: 'No pull requests yet.' };
}

/** The repos gh could not read, one line each. */
export const failedText = (failed: AllPRs['failed']) => failed.map((f) => `Could not read ${f.repo}: ${f.error}`).join('\n');

/** The toolbar's query, and the groups it leaves of what GET /prs listed. Kept for as long as the app is open. */
let kept: PRQuery = DEFAULT_PR_QUERY;
export function usePRQuery(data: AllPRs | undefined) {
  const [q, setQ] = useState(kept);
  const set: SetPRQuery = (next) => setQ((prev) => (kept = typeof next === 'function' ? next(prev) : next));
  const groups = data ? queryPRs(data.prs, q, data.viewer ?? null) : [];
  return { q, set, groups };
}

/** What the list says when the toolbar leaves no PR. */
export const noMatchText = (q: PRQuery) => (isNarrowed(q) ? 'No pull request matches this search and these filters.' : `No pull requests in ${q.repo}.`);

export function AllPRsPage() {
  const q = useAllPRs();
  const empty = allPRsEmpty(q);
  const failed = q.data?.failed ?? [];
  const { q: query, set, groups } = usePRQuery(q.data);
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader title="Pull requests" subtitle="Every channel’s repo." width="max-w-4xl" />
      <div className="mx-auto max-w-4xl px-4 pb-16 md:px-8">
        {empty?.kind === 'error' ? (
          <ErrorNote onRetry={q.reload}>{empty.text}</ErrorNote>
        ) : empty?.kind === 'loading' ? (
          <Loading label={empty.text} />
        ) : empty ? (
          <Empty icon="pr" title="No pull requests">
            {empty.text}
          </Empty>
        ) : (
          <>
            <PRToolbar q={query} set={set} prs={q.data!.prs} repos={q.data!.repos} onRefresh={q.reload} busy={q.loading} />
            {failed.length > 0 && <ErrorNote className="mt-3">{failedText(failed)}</ErrorNote>}
            {groups.length === 0 ? (
              <Empty icon="search" title="No match">
                {noMatchText(query)}
                {isNarrowed(query) && (
                  <div className="mt-3">
                    <Button size="sm" onClick={() => set((q) => ({ ...q, search: '', filters: {} }))}>
                      Clear search and filters
                    </Button>
                  </div>
                )}
              </Empty>
            ) : (
              groups.map((g) => (
                <section key={g.key} className="rise mt-4" aria-label={g.label}>
                  <PRGroupHead g={g} className="mb-1 px-3.5" />
                  {g.prs.map((p, i) => (
                    <AllPRRow key={`${p.repo}#${p.number}`} p={p} i={i} />
                  ))}
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AllPRRow({ p, i }: { p: ListedPR; i: number }) {
  const b = prBadge(p);
  return (
    <a href={p.url} target="_blank" rel="noreferrer" style={{ '--i': i } as CSSProperties} className="hov block rounded-[18px] px-3.5 py-3 [--hov:var(--surface)]">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="pr" size={14} className={b.label === 'open' ? 'text-live-text' : b.label === 'merged' ? 'text-fg-2' : 'text-fg-4'} />
        <span className="min-w-0 truncate text-[14px] font-medium">{p.title}</span>
        <span className="shrink-0 font-num text-[11.5px] text-fg-4">#{p.number}</span>
        <Chip tone={b.tone}>{b.label}</Chip>
        <span className="ml-auto shrink-0">
          <ChecksSummary c={p.checks} />
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-x-3 pl-[22px] text-[12px] text-fg-3">
        <span className="min-w-0 truncate font-mono text-[11.5px]">{p.repo}</span>
        <span className="shrink-0">{p.author?.login ?? 'unknown'}</span>
        {(p.labels ?? []).map((l) => (
          <Chip key={l} tone="outline" className="hidden sm:inline-flex">
            {l}
          </Chip>
        ))}
        <span className="ml-auto shrink-0 font-num text-[11px] text-fg-4">{relTime(p.updatedAt)}</span>
      </div>
    </a>
  );
}
