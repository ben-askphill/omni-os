import { codeRuns, mergeReady, mergeRiskTitle, mergeRiskVerdict, riskGap, shortHead, type MergeRiskP } from '@omni/shared/merge-risk.ts';
import { Icon, StatusPill } from '../ui.tsx';

// The merge-risk gate's rating of one head of the thread's PR (apps/server/merge-risk/gate.ts), in the transcript, so
// Ben can tell from the thread whether the PR is safe to merge. The same card on desktop and in the phone's turn.

const LEVEL_TONE: Record<MergeRiskP['level'], string> = { low: 'text-fg', medium: 'text-warn', high: 'text-danger-text', 'not rated': 'text-fg-2' };

/** The words of one gap, a backticked path in mono. */
function GapText({ text }: { text: string }) {
  return (
    <>
      {codeRuns(text).map((r, i) =>
        r.code ? (
          <code key={i} className="rounded-[6px] bg-bg px-1 py-px font-mono text-[11.5px] text-fg">
            {r.text}
          </code>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

export function MergeRiskCard({ p }: { p: MergeRiskP }) {
  const ready = mergeReady(p);
  const gaps = p.bullets.map(riskGap);
  return (
    <section aria-label={`Merge risk for pull request ${p.pr}`} data-merge-risk={p.level} className="rounded-[22px] bg-surface px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg ${ready ? 'text-fg' : 'text-fg-2'}`}>
          <Icon name={ready ? 'check' : 'pr'} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`min-w-0 text-[13.5px] font-medium ${LEVEL_TONE[p.level]}`}>{mergeRiskTitle(p)}</span>
            <span className="ml-auto shrink-0">
              <StatusPill status={ready ? 'done' : 'needs'} label={p.label} />
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] text-fg-3">
            <span className="text-fg-2">{mergeRiskVerdict(p)}</span>
            <span aria-hidden>·</span>
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-fg hover:underline">
              PR #{p.pr}
              <Icon name="external" size={12} className="text-fg-3" />
            </a>
            <span aria-hidden>·</span>
            <span title={p.head}>
              rated <span className="font-mono text-[11.5px]">{shortHead(p.head)}</span>
            </span>
          </div>
        </div>
      </div>
      {gaps.length > 0 && (
        <ul aria-label="Areas not rated good" className="mt-2 space-y-1 pl-11 text-[12.5px] leading-[1.5] text-fg-2">
          {gaps.map((g, i) => (
            <li key={i} data-verdict={g.verdict ?? undefined} className="flex min-w-0 items-baseline gap-2">
              {g.verdict && (
                <span className={`shrink-0 text-[11px] font-medium uppercase tracking-[0.04em] ${g.verdict === 'poor' ? 'text-danger-text' : 'text-warn'}`}>
                  {g.verdict}
                </span>
              )}
              <span className="min-w-0 break-words">
                {g.area && <span className="font-medium text-fg">{g.area} </span>}
                <GapText text={g.text} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.reason && <p className="mt-2 pl-11 text-[12.5px] leading-[1.5] break-words text-fg-2">{p.reason}</p>}
    </section>
  );
}
