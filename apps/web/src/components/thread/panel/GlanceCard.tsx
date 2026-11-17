import { useState, type ReactNode } from 'react';
import type { CrewPR, PRSummary, Thread } from '../../../api.ts';
import type { PanelTab } from '../../../pages/useThreadSession.ts';
import { plural } from '../../../format.ts';
import { mergeBlock, prBadge, prLine, STEP_WORKING, stepParkedText, type PRNext, type PRStep } from '@omni/shared/thread-glance.ts';
import { Chip, copyText, ErrorNote, Icon, IconButton, StatusDot, type IconName } from '../../ui.tsx';
import { MergeConfirm, MergeTrigger, StepButton, useMerge, type ThreadPRs } from './PRsTab.tsx';
import { CARD_PAD, ROW } from './inset.ts';

export type BranchChanges = { files: unknown[]; add: number; del: number } | null;

/**
 * A row of the glance cards. `onClick` makes it open something (a chevron at its end). `action` puts a button at its end
 * instead, beside the row rather than inside it, so the row and its button are two separate targets.
 */
function GlanceRow({ icon, children, onClick, label, action }: { icon: IconName; children: ReactNode; onClick?: () => void; label?: string; action?: ReactNode }) {
  const body = (
    <>
      <span className="grid size-5 shrink-0 place-items-center text-fg-3">
        <Icon name={icon} size={15} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-[var(--sp-4)]">{children}</span>
      {onClick && !action && <Icon name="chevronRight" size={13} className="shrink-0 text-fg-3" />}
    </>
  );
  const cls = `flex w-full min-w-0 items-center gap-[var(--sp-5)] ${ROW} text-left text-[12.5px]`;
  const row = onClick ? (
    <button type="button" aria-label={label} onClick={onClick} className={`hov ${cls} [--hov:var(--surface)]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
  if (!action) return row;
  return (
    <div className="flex min-w-0 items-center gap-[var(--sp-2)]">
      <div className="min-w-0 flex-1">{row}</div>
      <div className="flex shrink-0 items-center pr-[var(--sp-4)]">{action}</div>
    </div>
  );
}

function CopyBranch({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      icon={done ? 'check' : 'copy'}
      label={done ? 'Copied' : 'Copy the branch name'}
      size={13}
      className="-mr-[var(--sp-2)] h-6 w-6"
      onClick={() => {
        void copyText(name).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    />
  );
}

/**
 * The top of the Details tab: the branch, its PR and what changed, each opening its tab. The step the PR calls for (open
 * it, fix conflicts or checks, merge) sits at the end of the PR's row, and Merge asks first in a confirm under that row.
 * Ben's threads mostly end as a merged PR, so this is what he checks first. Nothing for a thread without a branch.
 */
export function GlanceCard({ thread, prs, changes, next, step, parked = null, onAsk, onMerged, onTab }: { thread: Thread; prs: ThreadPRs; changes: BranchChanges; next: PRNext; step: PRStep | null; parked?: PRStep | null; onAsk: (prompt: string) => void; onMerged: () => void; onTab: (tab: PanelTab) => void }) {
  if (!thread.branch) return null;
  const pr: PRSummary | null = prs?.pr ?? null;
  return (
    <section aria-label="Branch at a glance" className={`rounded-[var(--r-xl)] bg-bg ${CARD_PAD} shadow-[var(--shadow-card)]`}>
      <GlanceRow icon="branch">
        <span className="min-w-0 truncate font-mono text-[12px] text-fg">{thread.branch}</span>
        {pr?.baseRefName && <span className="shrink-0 text-fg-3">into {pr.baseRefName}</span>}
        <span className="ml-auto shrink-0">
          <CopyBranch name={thread.branch} />
        </span>
      </GlanceRow>
      <BranchPRRow key={pr?.number ?? 'none'} thread={thread} prs={prs} pr={pr} next={next} step={step} parked={parked} onAsk={onAsk} onMerged={onMerged} onTab={onTab} />
      <GlanceRow icon="diff" onClick={() => onTab('changes')} label="Show changes">
        {changes ? (
          changes.files.length ? (
            <>
              <span className="text-fg">{plural(changes.files.length, 'file')} changed</span>
              <span className="ml-auto flex shrink-0 gap-1.5 font-num text-[11.5px] tabular-nums">
                <span className="text-fg-2">+{changes.add}</span>
                <span className="text-fg-3">−{changes.del}</span>
              </span>
            </>
          ) : (
            <span className="text-fg-3">No changes against the base</span>
          )
        ) : (
          <span className="text-fg-3">Changes</span>
        )}
      </GlanceRow>
    </section>
  );
}

/** Under a row, inset to its text: the merge confirm, or why a step did not start. */
const UNDER_ROW = 'mx-[var(--sp-2)] mt-[var(--sp-1)] mb-[var(--sp-3)]';

/** The branch's PR row, with the step it calls for at its end: Open PR, Fix conflicts, Fix checks or Merge. */
function BranchPRRow({ thread, prs, pr, next, step, parked, onAsk, onMerged, onTab }: { thread: Thread; prs: ThreadPRs; pr: PRSummary | null; next: PRNext; step: PRStep | null; parked: PRStep | null; onAsk: (prompt: string) => void; onMerged: () => void; onTab: (tab: PanelTab) => void }) {
  const m = useMerge(thread.channel_id, pr?.number ?? 0, onMerged);
  const badge = pr ? prBadge(pr) : null;
  const line = pr ? prLine(pr) : null;
  // An open PR that cannot merge says why in a few words, the way a delegated PR's row does; the full line is its tooltip.
  const block = pr && (pr.state ?? 'OPEN') === 'OPEN' ? mergeBlock(pr) : null;
  const action = !next ? undefined : next.kind === 'merge' ? pr ? <MergeTrigger m={m} /> : undefined : <StepButton next={next} step={step} onAsk={onAsk} />;
  return (
    <>
      <GlanceRow icon="pr" onClick={() => onTab('prs')} label={pr && line ? `Show PRs: #${pr.number}, ${line.text}` : 'Show PRs'} action={action}>
        {prs === undefined ? (
          <span className="text-fg-3">Checking for a PR</span>
        ) : pr && badge && line ? (
          <>
            <span className="shrink-0 font-num text-fg tabular-nums">#{pr.number}</span>
            {block ? (
              <span className="flex min-w-0 items-center gap-[var(--sp-3)] text-fg-2" title={line.text}>
                <StatusDot status={block.dot} phase={block.dot === 'running' ? 'checking' : null} size={7} />
                <span className="truncate">{block.label}</span>
              </span>
            ) : (
              <>
                <Chip tone={badge.tone}>{badge.label}</Chip>
                <span className="min-w-0 truncate text-fg-3" title={line.text}>
                  {line.text}
                </span>
              </>
            )}
          </>
        ) : step === 'open' ? (
          <span className="text-fg-3">{STEP_WORKING.open}…</span>
        ) : (
          <span className="text-fg-3">No PR yet</span>
        )}
      </GlanceRow>
      {next?.kind === 'merge' && pr && <MergeConfirm m={m} base={pr.baseRefName} className={UNDER_ROW} />}
      {next && next.kind !== 'merge' && step === null && parked === next.kind && <ErrorNote className={UNDER_ROW}>{stepParkedText(parked, thread)}</ErrorNote>}
    </>
  );
}

/**
 * The open PRs from the threads this one delegated to, under the branch card. A Conductor thread has no branch of its
 * own, so this is where its delegates' work gets merged from: a PR that can merge has Merge at the end of its row, one
 * that cannot says why there instead. Merged ones leave the card and stay in the PRs tab.
 */
export function CrewGlance({ crew, onMerged, onTab }: { crew: CrewPR[]; onMerged: () => void; onTab: (tab: PanelTab) => void }) {
  const open = crew.filter((p) => p.state === 'OPEN');
  if (!open.length) return null;
  return (
    <section aria-label="Delegated PRs at a glance" className={`rounded-[var(--r-xl)] bg-bg ${CARD_PAD} shadow-[var(--shadow-card)]`}>
      {open.map((p) => (
        <CrewPRRow key={p.url} p={p} onMerged={onMerged} onTab={onTab} />
      ))}
    </section>
  );
}

function CrewPRRow({ p, onMerged, onTab }: { p: CrewPR; onMerged: () => void; onTab: (tab: PanelTab) => void }) {
  const m = useMerge(p.channel_id, p.number, onMerged);
  const block = mergeBlock(p);
  return (
    <>
      <GlanceRow icon="pr" onClick={() => onTab('prs')} label={`Show PRs: #${p.number} ${p.title}${block ? `. ${block.label}` : ''}`} action={block ? undefined : <MergeTrigger m={m} />}>
        <span className="shrink-0 font-num text-fg tabular-nums">#{p.number}</span>
        <span className="min-w-0 truncate text-fg-3" title={`${p.title} · from ${p.thread_title}`}>
          {p.title}
        </span>
        {block && (
          <span className="ml-auto flex shrink-0 items-center gap-[var(--sp-3)] pl-[var(--sp-2)] text-fg-2">
            <StatusDot status={block.dot} phase={block.dot === 'running' ? 'checking' : null} size={7} />
            {block.label}
          </span>
        )}
      </GlanceRow>
      {!block && <MergeConfirm m={m} className={UNDER_ROW} />}
    </>
  );
}
