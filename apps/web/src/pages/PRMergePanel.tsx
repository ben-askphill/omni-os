import { useState, type ReactNode } from 'react';
import { api, errorText, type Channel, type PRDetail as PRDetailT } from '../api.ts';
import { Button, ErrorNote, Icon, Segmented, SlideToConfirm, StatusDot, Toggle, type IconName, type SegOption } from '../components/ui.tsx';
import { useIsMobile } from '../store.tsx';
import { checkTone } from '@omni/shared/thread-glance.ts';
import { autoMergeView } from '@omni/shared/pr-auto-merge.ts';
import { PRAutoMerge } from './PRAutoMerge.tsx';
import { RerunNote, type useRerunFailedChecks } from '../components/RerunChecks.tsx';

type MergeMethod = 'squash' | 'merge' | 'rebase';

const MERGE_METHODS: { value: MergeMethod; short: string; label: string; does: string; sub: string }[] = [
  { value: 'squash', short: 'Squash', label: 'Squash and merge', does: 'Squashes into', sub: 'One commit on the base branch' },
  { value: 'merge', short: 'Merge commit', label: 'Merge commit', does: 'Merges with a merge commit into', sub: 'Keep every commit plus a merge commit' },
  { value: 'rebase', short: 'Rebase', label: 'Rebase and merge', does: 'Rebases onto', sub: 'Replay the commits, no merge commit' },
];
const METHOD_OPTIONS: SegOption<MergeMethod>[] = MERGE_METHODS.map((m) => ({ id: m.value, label: m.short, title: m.sub }));

/** One thing a merge needs, as a row: a mark for met, waiting or in the way, what it is, and its fix beside it. */
function Requirement({ mark, icon, children, action }: { mark: 'done' | 'needs' | 'running' | 'queued'; icon: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    // The fix wraps under the words on a narrow card rather than squeezing them.
    <li className="flex min-h-9 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line py-1.5 first:border-t-0">
      <StatusDot status={mark} size={8} className="shrink-0" />
      <Icon name={icon} size={14} className="text-fg-3" />
      <span className="min-w-[min(14rem,100%)] flex-1 text-[length:var(--fs-ui)] text-fg-2">{children}</span>
      {action && <span className="ml-auto">{action}</span>}
    </li>
  );
}

/**
 * The merge card on an open pull request, above the tabs. It leads with the answer (Ready to merge, Has conflicts,
 * 1 check failing) with Auto-merge beside it, lists each requirement as a row with its fix beside it (Rerun failed
 * checks on the checks row), then a footer with the method, Delete branch and the merge control, and one sentence on
 * what the merge does. The desktop shell gets a plain button named for the method: a mouse drag on the slide often fell
 * short and never registered. The phone layout shows this card too (its channel PR screen) and keeps the slide, as its
 * thread PR screen does. After a merge it shows gh's output in place of the card; `onMerged` reloads the pull request.
 */
export function PRMergePanel({
  channel,
  p,
  n,
  onMerged,
  rerun,
}: {
  channel: Channel;
  p: PRDetailT;
  n: number;
  onMerged: () => void;
  rerun: ReturnType<typeof useRerunFailedChecks>;
}) {
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const phone = useIsMobile();
  const open = !p.state || p.state === 'OPEN';

  // A failed merge leaves the card as it was, with gh's message under the control. The slide springs back on a throw.
  const doMerge = async () => {
    setMergeError(null);
    setMerging(true);
    try {
      const r = await api.post<{ ok: boolean; output: string }>(`/channels/${encodeURIComponent(channel.id)}/prs/${n}/merge`, {
        method,
        delete_branch: deleteBranch,
        confirm: true,
      });
      setMerged(r.output?.trim() || 'Merged.');
      onMerged();
    } catch (e) {
      setMergeError(errorText(e));
      throw e;
    } finally {
      setMerging(false);
    }
  };

  const failed = p.checkRuns.filter((c) => checkTone(c.state) === 'needs').length;
  const running = p.checkRuns.filter((c) => checkTone(c.state) === 'running').length;
  const passed = p.checkRuns.length - failed - running;
  const conflicting = p.mergeable === 'CONFLICTING';
  const review = p.reviewDecision;
  const changesRequested = review === 'CHANGES_REQUESTED';
  const auto = autoMergeView(p.autoMergeRequest);
  const m = MERGE_METHODS.find((x) => x.value === method)!;
  const failing = failed === 1 ? '1 check failing' : `${failed} checks failing`;
  const checksDetail = [passed > 0 && `${passed} passed`, failed > 0 && running > 0 && `${running} running`].filter(Boolean).join(', ');
  const code = 'font-mono text-[length:var(--fs-code)] text-fg-2';

  // The first thing in the way names the card; with nothing in the way, running checks do, then Ready to merge.
  const [headline, headMark] = merging
    ? ['Merging', 'running']
    : conflicting
      ? ['Has conflicts', 'needs']
      : failed
        ? [failing, 'needs']
        : p.isDraft
          ? ['Still a draft', 'needs']
          : changesRequested
            ? ['Changes requested', 'needs']
            : running
              ? ['Checks running', 'running']
              : ['Ready to merge', 'done'];

  return (
    <>
      {open && !merged && (
        <section aria-label="Merge" className="mt-5 rounded-[var(--r-xl)] bg-surface px-4 pt-3.5 pb-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <StatusDot status={headMark} size={12} className="shrink-0" />
            <h3 className="font-display text-[length:var(--fs-heading)] leading-tight text-fg">{headline}</h3>
            <PRAutoMerge channelId={channel.id} n={n} p={p} method={method} onChanged={onMerged} className="ml-auto" />
          </div>
          <ul aria-label="What the merge needs" className="mt-2.5">
            <Requirement mark={conflicting ? 'needs' : p.mergeable === 'MERGEABLE' ? 'done' : 'running'} icon="branch">
              {conflicting ? (
                <>
                  <span className="text-fg">Conflicts with {p.baseRefName}.</span> Resolve them on the branch first.
                </>
              ) : p.mergeable === 'MERGEABLE' ? (
                `No conflicts with ${p.baseRefName}`
              ) : (
                `Checking for conflicts with ${p.baseRefName}`
              )}
            </Requirement>
            {p.checkRuns.length > 0 && (
              <Requirement
                mark={failed ? 'needs' : running ? 'running' : 'done'}
                icon="check"
                action={
                  rerun.can && (
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => void rerun.run()} busy={rerun.busy} title="Runs gh run rerun --failed for each failing workflow run. No agent turn.">
                      Rerun failed checks
                    </Button>
                  )
                }
              >
                {failed ? <span className="text-fg">{failing}</span> : running ? `${running} ${running === 1 ? 'check' : 'checks'} running` : 'All checks passed'}
                {(failed > 0 || running > 0) && checksDetail && <span className="text-fg-3"> · {checksDetail}</span>}
              </Requirement>
            )}
            {review && (
              <Requirement mark={review === 'APPROVED' ? 'done' : changesRequested ? 'needs' : 'queued'} icon="message">
                {review === 'APPROVED' ? 'Approved' : changesRequested ? <span className="text-fg">Changes requested</span> : 'Review requested'}
              </Requirement>
            )}
            {p.isDraft && (
              <Requirement mark="needs" icon="pencil">
                <span className="text-fg">Still a draft.</span> Mark it ready for review on GitHub.
              </Requirement>
            )}
          </ul>
          <RerunNote outcome={rerun.outcome} className="mt-2" />
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[var(--r-lg)] bg-surface-2 py-2 pr-2 pl-3">
            <Segmented size="sm" label="Merge method" value={method} onChange={setMethod} options={METHOD_OPTIONS} />
            <label className="flex items-center gap-2 text-[length:var(--fs-ui)] text-fg-2">
              <Toggle checked={deleteBranch} onChange={setDeleteBranch} label="Delete branch after merge" />
              Delete branch
            </label>
            {phone ? (
              // A control's width, not the card's: it shrinks on a phone and still holds the longest label.
              <SlideToConfirm
                className="w-full max-w-[20rem]"
                label={conflicting ? 'Resolve conflicts first' : `Slide to ${m.label.toLowerCase()}`}
                busyLabel="Merging"
                doneLabel="Merged"
                disabled={conflicting}
                onConfirm={doMerge}
              />
            ) : (
              <Button variant="primary" className="ml-auto" disabled={conflicting} busy={merging} onClick={() => void doMerge().catch(() => {})}>
                {conflicting ? 'Resolve conflicts first' : merging ? 'Merging' : m.label}
              </Button>
            )}
          </div>
          <p className="mt-2 px-1 text-[length:var(--fs-12)] leading-[1.45] text-fg-3" title={`Runs gh pr merge: ${p.headRefName} into ${p.baseRefName} on ${channel.github_repo}`}>
            {m.does} <span className={code}>{p.baseRefName}</span>
            {deleteBranch && (
              <>
                , then deletes <span className={code}>{p.headRefName}</span>
              </>
            )}
            . Can’t be undone from here.
            {auto.on && ` Auto-merge: ${auto.detail.charAt(0).toLowerCase()}${auto.detail.slice(1)}${auto.by ? `. ${auto.by}` : ''}.`}
          </p>
          {mergeError && <ErrorNote className="mt-2">{mergeError}</ErrorNote>}
        </section>
      )}
      {merged && (
        <div className="pop-in mt-5 flex items-start gap-2.5 rounded-[var(--r-xl)] bg-surface px-4 py-3 text-[length:var(--fs-ui)] text-fg">
          <StatusDot status="done" size={9} className="mt-1 shrink-0" />
          <span className="whitespace-pre-wrap">{merged}</span>
        </div>
      )}
    </>
  );
}
