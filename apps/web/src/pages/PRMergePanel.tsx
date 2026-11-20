import { useState } from 'react';
import { api, errorText, type Channel, type PRDetail as PRDetailT } from '../api.ts';
import { Button, Chip, ErrorNote, Picker, SlideToConfirm, StatusDot, Toggle, type PickerOption } from '../components/ui.tsx';
import { useIsMobile } from '../store.tsx';
import { checkTone } from '@omni/shared/thread-glance.ts';
import { autoMergeView } from '@omni/shared/pr-auto-merge.ts';
import { PRAutoMerge } from './PRAutoMerge.tsx';
import { RerunNote, type useRerunFailedChecks } from '../components/RerunChecks.tsx';

type MergeMethod = 'squash' | 'merge' | 'rebase';

const MERGE_METHODS: PickerOption<MergeMethod>[] = [
  { value: 'squash', label: 'Squash and merge', sub: 'One commit on the base branch', avatar: false },
  { value: 'merge', label: 'Merge commit', sub: 'Keep every commit plus a merge commit', avatar: false },
  { value: 'rebase', label: 'Rebase and merge', sub: 'Replay the commits, no merge commit', avatar: false },
];

/**
 * The merge card on an open pull request, kept to one block above the tabs: method, delete-branch and auto-merge on one
 * row, then what stands in the way (with Rerun failed checks beside the failing count), the merge control and a one-line
 * note. The desktop shell gets a plain button named for the method: a mouse drag on the slide often fell short and never
 * registered. The phone layout shows this card too (its channel PR screen) and keeps the slide, as its thread PR screen does.
 * After a merge it shows gh's output in place of the card; `onMerged` reloads the pull request.
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
  const warnings = [p.isDraft && 'Still a draft', p.reviewDecision === 'CHANGES_REQUESTED' && 'Changes requested'].filter(Boolean) as string[];
  const conflicting = p.mergeable === 'CONFLICTING';
  const blocked = conflicting || failed > 0 || warnings.length > 0 || rerun.can;
  const code = 'font-mono text-[length:var(--fs-code)] text-fg-2';
  const auto = autoMergeView(p.autoMergeRequest);
  const methodLabel = MERGE_METHODS.find((m) => m.value === method)?.label ?? 'Merge';

  return (
    <>
      {open && !merged && (
        <section aria-label="Merge" className="mt-5 rounded-[var(--r-xl)] bg-surface px-4 pt-3.5 pb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Picker label="Merge method" value={method} onChange={setMethod} options={MERGE_METHODS} />
            <label className="flex items-center gap-2 text-[length:var(--fs-ui)] text-fg-2">
              <Toggle checked={deleteBranch} onChange={setDeleteBranch} label="Delete branch after merge" />
              Delete branch
            </label>
            <PRAutoMerge channelId={channel.id} n={n} p={p} method={method} onChanged={onMerged} className="ml-auto" />
          </div>
          {blocked && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {conflicting && <Chip tone="needs">Has conflicts</Chip>}
              {failed > 0 && <Chip tone="needs">{failed === 1 ? '1 check failing' : `${failed} checks failing`}</Chip>}
              {warnings.map((w) => (
                <Chip key={w} tone="needs">
                  {w}
                </Chip>
              ))}
              {rerun.can && (
                <Button size="sm" variant="ghost" icon="refresh" onClick={() => void rerun.run()} busy={rerun.busy} title="Runs gh run rerun --failed for each failing workflow run. No agent turn.">
                  Rerun failed checks
                </Button>
              )}
            </div>
          )}
          <RerunNote outcome={rerun.outcome} className="mt-3" />
          {phone ? (
            // A control's width, not the card's: it shrinks on a phone and still holds the longest label.
            <SlideToConfirm
              className="mt-3 w-full max-w-[20rem]"
              label={conflicting ? 'Resolve conflicts first' : `Slide to ${methodLabel.toLowerCase()}`}
              busyLabel="Merging"
              doneLabel="Merged"
              disabled={conflicting}
              onConfirm={doMerge}
            />
          ) : (
            <Button variant="primary" className="mt-3" disabled={conflicting} busy={merging} onClick={() => void doMerge().catch(() => {})}>
              {conflicting ? 'Resolve conflicts first' : merging ? 'Merging' : methodLabel}
            </Button>
          )}
          <p className="mt-2 px-1 text-[length:var(--fs-12)] leading-[1.45] text-fg-3" title={`${p.headRefName} into ${p.baseRefName} on ${channel.github_repo}`}>
            Runs <span className={code}>gh pr merge</span>
            {deleteBranch ? ', then deletes the branch' : ''}. Can’t be undone from here.
            {auto.on && ` Auto-merge: ${auto.detail.charAt(0).toLowerCase()}${auto.detail.slice(1)}${auto.by ? `. ${auto.by}` : ''}.`}
          </p>
          {mergeError && <ErrorNote className="mt-3">{mergeError}</ErrorNote>}
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
