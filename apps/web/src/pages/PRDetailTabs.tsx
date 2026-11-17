import { Markdown } from '../components/Markdown.tsx';
import { DiffViewer } from '../components/DiffViewer.tsx';
import { Avatar, Chip, Icon, IconLink } from '../components/ui.tsx';
import { fullDate } from '../format.ts';
import { checkTone } from '@omni/shared/thread-glance.ts';
import type { PRDetail as PRDetailT } from '../api.ts';

/** GitHub hides HTML comments (PR templates, bots); react-markdown would print them. */
const ghBody = (s: string | null | undefined) => (s ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();

function checkGlyph(state: string) {
  const t = checkTone(state);
  return t === 'done' ? '✓' : t === 'needs' ? '✗' : '•';
}

/** Lines added and removed, in the diff colours. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-num text-[length:var(--fs-code)] tabular-nums">
      <span className="text-[color:var(--diff-add-fg)]">+{additions}</span> <span className="text-[color:var(--diff-del-fg)]">−{deletions}</span>
    </span>
  );
}

export type DetailTab = 'conversation' | 'checks' | 'changes';

/** The body under the tabs of a pull request: description and comments, check runs, or the changes. */
export function PRDetailTabBody({ tab, p }: { tab: DetailTab; p: PRDetailT }) {
  return (
    <>
          {tab === 'conversation' && (
            <div className="space-y-4">
              <div className="rounded-[var(--r-xl)] bg-surface px-5 py-4">
                {ghBody(p.body) ? <Markdown text={ghBody(p.body)} gateRemoteImages /> : <div className="text-[13px] text-fg-3">No description.</div>}
              </div>
              {[...(p.reviews ?? []).filter((r) => r.body?.trim() || r.state !== 'COMMENTED').map((r) => ({ kind: 'review' as const, who: r.author?.login, at: r.submittedAt, body: r.body, state: r.state })),
                ...(p.comments ?? []).map((c) => ({ kind: 'comment' as const, who: c.author?.login, at: c.createdAt, body: c.body, state: '' }))]
                .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1))
                .map((c, i) => (
                  <div key={i} className="rounded-[var(--r-xl)] bg-surface">
                    <div className="flex items-center gap-2 px-4 pt-3 text-[12.5px] text-fg-3">
                      <Avatar name={c.who ?? '?'} size={22} />
                      <span className="font-medium text-fg-2">{c.who ?? 'unknown'}</span>
                      {c.kind === 'review' && <Chip tone={c.state === 'APPROVED' ? 'done' : c.state === 'CHANGES_REQUESTED' ? 'needs' : 'default'}>{c.state.toLowerCase().replace(/_/g, ' ')}</Chip>}
                      {c.at && <span className="ml-auto font-num text-[11px] text-fg-3">{fullDate(c.at)}</span>}
                    </div>
                    {ghBody(c.body) && (
                      <div className="px-4 pt-2 pb-3.5">
                        <Markdown text={ghBody(c.body)} gateRemoteImages />
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
          {tab === 'checks' &&
            (p.checkRuns.length ? (
              <div className="overflow-hidden rounded-[var(--r-xl)] bg-surface p-1.5">
                {p.checkRuns.map((c, i) => (
                  <div key={i} className="flex h-10 items-center gap-2.5 rounded-[var(--r-md)] px-3 text-[13px]">
                    <span className={`w-3 font-mono ${checkTone(c.state)}`}>{checkGlyph(c.state)}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className={`font-num text-[11px] ${checkTone(c.state)}`}>{c.state.toLowerCase().replace(/_/g, ' ') || 'pending'}</span>
                    {c.url && (
                      <IconLink href={c.url} icon="external" label="Open check" size={13} newTab external />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[13px] text-fg-3">No checks on this PR.</div>
            ))}
          {tab === 'changes' && <PRChanges p={p} />}
    </>
  );
}

/**
 * The diff, file by file: each file's header already carries its path and counts, so it doubles as the file list. When
 * gh could not hand over a diff it can read, the changed files stand in, under what gh said.
 */
function PRChanges({ p }: { p: PRDetailT }) {
  const diff = p.diff ?? '';
  if (/^diff --git /m.test(diff) || !p.files?.length) return <DiffViewer diff={diff} />;
  return (
    <div className="space-y-3">
      {diff.trim() && <div className="text-[length:var(--fs-small)] text-fg-3">{diff.trim()}</div>}
      <div className="overflow-hidden rounded-[var(--r-xl)] bg-surface p-1.5">
        {p.files.map((f) => (
          <div key={f.path} className="flex h-9 min-w-0 items-center gap-2 rounded-[var(--r-md)] px-3 text-[12.5px]">
            <Icon name="file" size={13} className="text-fg-3" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
            <DiffStat additions={f.additions} deletions={f.deletions} />
          </div>
        ))}
      </div>
    </div>
  );
}
