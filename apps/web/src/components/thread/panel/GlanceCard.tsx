import { useState, type ReactNode } from 'react';
import type { PRSummary, Thread } from '../../../api.ts';
import type { PanelTab } from '../../../pages/useThreadSession.ts';
import { plural } from '../../../format.ts';
import { prBadge, prLine, type PRNext } from '@omni/shared/thread-glance.ts';
import { Chip, copyText, Icon, IconButton, type IconName } from '../../ui.tsx';
import { PRNextButton, type ThreadPRs } from './PRsTab.tsx';

export type BranchChanges = { files: unknown[]; add: number; del: number } | null;

function GlanceRow({ icon, children, onClick, label }: { icon: IconName; children: ReactNode; onClick?: () => void; label?: string }) {
  const body = (
    <>
      <Icon name={icon} size={15} className="shrink-0 text-fg-3" />
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {onClick && <Icon name="chevronRight" size={13} className="shrink-0 text-fg-4" />}
    </>
  );
  const cls = 'flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[12px] px-2.5 text-left text-[12.5px]';
  return onClick ? (
    <button type="button" aria-label={label} onClick={onClick} className={`hov ${cls} [--hov:var(--surface)]`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function CopyBranch({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      icon={done ? 'check' : 'copy'}
      label={done ? 'Copied' : 'Copy the branch name'}
      size={13}
      className="h-6 w-6"
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
 * The top of the Details tab: the branch, its PR and what changed, each opening its tab, then the one step the PR calls
 * for (open it, fix conflicts or checks, merge). Ben's threads mostly end as a merged PR, so this is what he checks first.
 * Nothing for a thread without a branch.
 */
export function GlanceCard({ thread, prs, changes, next, busy, onAsk, onTab }: { thread: Thread; prs: ThreadPRs; changes: BranchChanges; next: PRNext; busy: boolean; onAsk: (prompt: string) => void; onTab: (tab: PanelTab) => void }) {
  if (!thread.branch) return null;
  const pr: PRSummary | null = prs?.pr ?? null;
  const badge = pr ? prBadge(pr) : null;
  const line = pr ? prLine(pr) : null;
  return (
    <section aria-label="Branch at a glance" className="rounded-[18px] border border-line bg-bg p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <GlanceRow icon="branch">
        <span className="min-w-0 truncate font-mono text-[12px] text-fg">{thread.branch}</span>
        {pr?.baseRefName && <span className="shrink-0 text-fg-3">into {pr.baseRefName}</span>}
        <span className="ml-auto shrink-0">
          <CopyBranch name={thread.branch} />
        </span>
      </GlanceRow>
      <GlanceRow icon="pr" onClick={() => onTab('prs')} label="Show PRs">
        {prs === undefined ? (
          <span className="text-fg-3">Checking for a PR</span>
        ) : pr && badge && line ? (
          <>
            <span className="shrink-0 font-num text-fg tabular-nums">#{pr.number}</span>
            <Chip tone={line.tone === 'needs' ? 'needs' : badge.tone}>{line.tone === 'needs' && badge.label === 'open' ? 'blocked' : badge.label}</Chip>
            <span className="min-w-0 truncate text-fg-3">{line.text}</span>
          </>
        ) : (
          <span className="text-fg-3">No PR yet</span>
        )}
      </GlanceRow>
      <GlanceRow icon="diff" onClick={() => onTab('changes')} label="Show changes">
        {changes ? (
          changes.files.length ? (
            <>
              <span className="text-fg">{plural(changes.files.length, 'file')} changed</span>
              <span className="ml-auto flex shrink-0 gap-1.5 font-num text-[11.5px] tabular-nums">
                <span className="text-fg-2">+{changes.add}</span>
                <span className="text-fg-4">−{changes.del}</span>
              </span>
            </>
          ) : (
            <span className="text-fg-3">No changes against the base</span>
          )
        ) : (
          <span className="text-fg-3">Changes</span>
        )}
      </GlanceRow>
      {next && (
        <div className="mt-1 flex border-t border-line px-1 pt-2 pb-1 [&>*]:flex-1">
          <PRNextButton next={next} thread={thread} pr={pr} busy={busy} onAsk={onAsk} />
        </div>
      )}
    </section>
  );
}
