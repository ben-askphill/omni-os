import { Chip, ErrorNote } from '../components/ui.tsx';
import { allPRsEmpty, failedText, useAllPRs } from '../pages/AllPRs.tsx';
import { prBadge } from '@omni/shared/thread-glance.ts';
import { useNow } from '../store.tsx';
import { HeaderActions } from './HeaderActions.tsx';
import { MoEmpty, MoHeader, MoScroll, MoTitle } from './parts.tsx';
import { shortTime } from './rows.ts';

/** The PRs tab: every channel's pull requests, open first, newest first. A row opens the PR on GitHub. */
export function PRsScreen() {
  const q = useAllPRs();
  const now = useNow(60_000);
  const empty = allPRsEmpty(q);
  const prs = q.data?.prs ?? [];
  const failed = q.data?.failed ?? [];
  const open = prs.filter((p) => (p.state ?? 'OPEN') === 'OPEN').length;
  const repos = q.data?.repos.length ?? 0;

  return (
    <>
      <MoHeader left={<span className="w-10" />} right={<HeaderActions />} />
      <MoScroll tabBar>
        <MoTitle title="PRs" sub={repos ? `${open} open across ${repos} ${repos === 1 ? 'repo' : 'repos'}` : 'Pull requests from every channel'} />
        {empty?.kind === 'error' ? (
          <ErrorNote className="mx-4" onRetry={q.reload}>
            {empty.text}
          </ErrorNote>
        ) : empty ? (
          <MoEmpty>{empty.text}</MoEmpty>
        ) : (
          <div className="flex flex-col px-4">
            {prs.map((p, i) => {
              const b = prBadge(p);
              return (
                <a key={`${p.repo}#${p.number}`} href={p.url} target="_blank" rel="noreferrer" className="mo-row flex min-w-0 w-full flex-col gap-0.5 px-1 py-2.5 text-left">
                  <span className={`-mb-2.5 flex min-w-0 flex-col gap-0.5 pb-2.5 ${i === prs.length - 1 ? '' : 'border-b border-line'}`}>
                    <span className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[15px] leading-[1.3] ${(p.state ?? 'OPEN') === 'OPEN' ? 'text-fg' : 'text-fg-2'}`}>{p.title}</span>
                      <Chip tone={b.tone}>{b.label}</Chip>
                    </span>
                    <span className="flex items-baseline gap-2 text-[12.5px] leading-[1.35] text-fg-3">
                      <span className="min-w-0 flex-1 truncate">
                        {p.repo} #{p.number} · {p.author?.login ?? 'unknown'}
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums">{shortTime(p.updatedAt, now)}</span>
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
        {!empty && failed.length > 0 && <ErrorNote className="mx-4">{failedText(failed)}</ErrorNote>}
      </MoScroll>
    </>
  );
}
