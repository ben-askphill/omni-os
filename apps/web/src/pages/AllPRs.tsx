import type { CSSProperties } from 'react';
import { useApi, type AllPRs, type Async } from '../api.ts';
import { Button, Chip, Empty, ErrorNote, Icon, Loading, PageHeader } from '../components/ui.tsx';
import { relTime } from '@omni/shared/format.ts';
import { prBadge } from '@omni/shared/thread-glance.ts';
import { ChecksSummary } from './PRs.tsx';

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

export function AllPRsPage() {
  const q = useAllPRs();
  const empty = allPRsEmpty(q);
  const failed = q.data?.failed ?? [];
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        title="Pull requests"
        subtitle="Every channel’s repo, open first, newest first."
        width="max-w-4xl"
        actions={
          <Button size="sm" variant="ghost" icon="refresh" onClick={q.reload} busy={q.loading && !!q.data}>
            Refresh
          </Button>
        }
      />
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
            {failed.length > 0 && <ErrorNote className="mb-3">{failedText(failed)}</ErrorNote>}
            <div className="rise">
              {q.data!.prs.map((p, i) => {
                const b = prBadge(p);
                return (
                  <a
                    key={`${p.repo}#${p.number}`}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ '--i': i } as CSSProperties}
                    className="hov block rounded-[18px] px-3.5 py-3 [--hov:var(--surface)]"
                  >
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
                      <span className="ml-auto shrink-0 font-num text-[11px] text-fg-4">{relTime(p.updatedAt)}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
