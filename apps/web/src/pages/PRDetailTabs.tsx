import { Markdown } from '../components/Markdown.tsx';
import { DiffViewer } from '../components/DiffViewer.tsx';
import { Avatar, Chip, Icon, IconLink } from '../components/ui.tsx';
import { fullDate } from '../format.ts';
import type { PRDetail as PRDetailT } from '../api.ts';

/** GitHub hides HTML comments (PR templates, bots); react-markdown would print them. */
const ghBody = (s: string | null | undefined) => (s ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();

/** A check run's state as a glyph: done, needs (failed) or running. */
export function checkTone(state: string) {
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) return 'done';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state)) return 'needs';
  return 'running';
}
function checkGlyph(state: string) {
  const t = checkTone(state);
  return t === 'done' ? '✓' : t === 'needs' ? '✗' : '•';
}

export type DetailTab = 'conversation' | 'checks' | 'files' | 'diff';

/** The body under the tabs of a pull request: description and comments, check runs, changed files or the diff. */
export function PRDetailTabBody({ tab, p, onFiles }: { tab: DetailTab; p: PRDetailT; onFiles: () => void }) {
  return (
    <>
          {tab === 'conversation' && (
            <div className="space-y-4">
              <div className="rounded-[20px] bg-surface px-5 py-4">
                {ghBody(p.body) ? <Markdown text={ghBody(p.body)} /> : <div className="text-[13px] text-fg-3">No description.</div>}
              </div>
              {[...(p.reviews ?? []).filter((r) => r.body?.trim() || r.state !== 'COMMENTED').map((r) => ({ kind: 'review' as const, who: r.author?.login, at: r.submittedAt, body: r.body, state: r.state })),
                ...(p.comments ?? []).map((c) => ({ kind: 'comment' as const, who: c.author?.login, at: c.createdAt, body: c.body, state: '' }))]
                .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1))
                .map((c, i) => (
                  <div key={i} className="rounded-[20px] bg-surface">
                    <div className="flex items-center gap-2 px-4 pt-3 text-[12.5px] text-fg-3">
                      <Avatar name={c.who ?? '?'} size={22} />
                      <span className="font-medium text-fg-2">{c.who ?? 'unknown'}</span>
                      {c.kind === 'review' && <Chip tone={c.state === 'APPROVED' ? 'done' : c.state === 'CHANGES_REQUESTED' ? 'needs' : 'default'}>{c.state.toLowerCase().replace(/_/g, ' ')}</Chip>}
                      {c.at && <span className="ml-auto font-num text-[11px] text-fg-4">{fullDate(c.at)}</span>}
                    </div>
                    {ghBody(c.body) && (
                      <div className="px-4 pt-2 pb-3.5">
                        <Markdown text={ghBody(c.body)} />
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
          {tab === 'checks' &&
            (p.checkRuns.length ? (
              <div className="overflow-hidden rounded-[20px] bg-surface p-1.5">
                {p.checkRuns.map((c, i) => (
                  <div key={i} className="flex h-10 items-center gap-2.5 rounded-2xl px-3 text-[13px]">
                    <span className={`w-3 font-mono ${checkTone(c.state)}`}>{checkGlyph(c.state)}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className={`font-num text-[11px] ${checkTone(c.state)}`}>{c.state.toLowerCase().replace(/_/g, ' ') || 'pending'}</span>
                    {c.url && (
                      <IconLink href={c.url} icon="external" label="Open check" size={13} newTab />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[13px] text-fg-3">No checks on this PR.</div>
            ))}
          {tab === 'files' && (
            <div className="overflow-hidden rounded-[20px] bg-surface p-1.5">
              {(p.files ?? []).map((f) => (
                <button
                  type="button"
                  key={f.path}
                  onClick={() => onFiles()}
                  className="hov flex h-9 w-full min-w-0 items-center gap-2 rounded-2xl px-3 text-left text-[12.5px] [--hov:var(--surface-2)]"
                >
                  <Icon name="file" size={13} className="text-fg-4" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
                  <span className="font-num text-[11px] text-fg-2">+{f.additions}</span>
                  <span className="font-num text-[11px] text-fg-3">-{f.deletions}</span>
                </button>
              ))}
              {!p.files?.length && <div className="px-3.5 py-2 text-[13px] text-fg-3">No files.</div>}
            </div>
          )}
          {tab === 'diff' && <DiffViewer diff={p.diff ?? ''} />}
    </>
  );
}
