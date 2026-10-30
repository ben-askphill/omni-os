import { useState } from 'react';
import { api, errorText, type Channel, type PRDetail as PRDetailT } from '../api.ts';
import { Chip, ErrorNote, Picker, SlideToConfirm, StatusDot, Toggle, type PickerOption } from '../components/ui.tsx';
import { checkTone } from './PRDetailTabs.tsx';

type MergeMethod = 'squash' | 'merge' | 'rebase';

const MERGE_METHODS: PickerOption<MergeMethod>[] = [
  { value: 'squash', label: 'Squash and merge', sub: 'One commit on the base branch', avatar: false },
  { value: 'merge', label: 'Merge commit', sub: 'Keep every commit plus a merge commit', avatar: false },
  { value: 'rebase', label: 'Rebase and merge', sub: 'Replay the commits, no merge commit', avatar: false },
];

/**
 * The merge card on an open pull request: method, delete-branch, warnings and the slide to confirm. After a merge it shows
 * gh's output in place of the card; `onMerged` reloads the pull request.
 */
export function PRMergePanel({ channel, p, n, onMerged }: { channel: Channel; p: PRDetailT; n: number; onMerged: () => void }) {
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
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
      onMerged();
    } catch (e) {
      setMergeError(errorText(e));
      throw e;
    }
  };

  const failed = p.checkRuns.filter((c) => checkTone(c.state) === 'needs').length;
  const warnings = [failed > 0 && `${failed} checks failing`, p.isDraft && 'Still a draft', p.reviewDecision === 'CHANGES_REQUESTED' && 'Changes requested'].filter(Boolean) as string[];
  const conflicting = p.mergeable === 'CONFLICTING';

  return (
    <>
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
              {conflicting && <Chip tone="needs">Has conflicts</Chip>}
              {warnings.map((w) => (
                <Chip key={w} tone="needs">
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
        <div className="pop-in mt-5 flex items-start gap-2.5 rounded-[20px] bg-surface px-4 py-3 text-[13px] text-fg">
          <StatusDot status="done" size={9} className="mt-1 shrink-0" />
          <span className="whitespace-pre-wrap">{merged}</span>
        </div>
      )}
    </>
  );
}
