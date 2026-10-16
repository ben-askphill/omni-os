import { useEffect, useMemo, useRef } from 'react';
import { useApi, type BranchChanges, type Thread } from '../../../api.ts';
import { baseLabel, changesView, shortSha, STATUS_LETTER } from '../../../changes.ts';
import { startsOpen } from '../../../diff.ts';
import { plural } from '../../../format.ts';
import { DiffFile } from '../../DiffViewer.tsx';
import { Empty, ErrorNote, IconButton, Loading } from '../../ui.tsx';

/**
 * The thread's branch changes before any PR, read-only: its checkout against the base commit Omni recorded, split
 * into committed, staged, unstaged and untracked. Loads when opened, again when a turn ends, and on Refresh.
 */
export function ChangesTab({ thread }: { thread: Thread }) {
  const { data, error, loading, reload } = useApi<BranchChanges>(`/threads/${encodeURIComponent(thread.id)}/changes`);
  const view = useMemo(() => (data ? changesView(data) : null), [data]);

  // A turn that ends has likely changed files.
  const status = useRef(thread.status);
  useEffect(() => {
    if (status.current !== thread.status && thread.status !== 'running' && thread.status !== 'queued') reload();
    status.current = thread.status;
  }, [thread.status, reload]);

  if (!data) {
    return <div className="px-3">{error ? <ErrorNote onRetry={reload}>{error}</ErrorNote> : <Loading label="Loading changes" />}</div>;
  }
  if (!data.available) {
    return (
      <div className="scroll-thin h-full overflow-y-auto">
        <Empty icon="diff" title="No changes to show">
          {data.reason}
        </Empty>
      </div>
    );
  }

  const base = data.base;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 px-3.5 pb-2.5">
        <div className="min-w-0 flex-1 text-[12px] leading-snug text-fg-3">
          <div className="truncate">
            <span className="text-fg-2">Base </span>
            <span className="font-mono text-[11.5px] text-fg" title={base.sha}>
              {shortSha(base.sha)}
            </span>
            <span>, {baseLabel(base)}</span>
          </div>
          {view && view.files > 0 && (
            <div className="font-num text-[11px]">
              {plural(view.files, 'file')} <span className="text-fg-2">+{view.additions}</span> <span>-{view.deletions}</span>
              {data.branch && <span className="font-mono"> on {data.branch}</span>}
            </div>
          )}
        </div>
        <IconButton icon="refresh" label="Refresh changes" size={14} onClick={reload} className={loading ? 'opacity-50' : ''} />
      </div>
      {error && (
        <ErrorNote className="mx-3 mb-2" onRetry={reload}>
          {error}
        </ErrorNote>
      )}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {!view?.files ? (
          <Empty icon="diff" title="No changes">
            Nothing changed since {shortSha(base.sha)}: no commits, staged, unstaged or untracked files.
          </Empty>
        ) : (
          view.groups.map((g) => (
            <section key={g.kind} className="mb-4" aria-label={`${g.title} changes`}>
              <div className="flex items-center gap-2 px-1.5 pb-1.5 text-[11.5px] font-medium text-fg-3">
                <span>{g.title}</span>
                <span className="font-num text-fg-4">{g.files.length}</span>
              </div>
              <div className="space-y-2">
                {g.files.map((f) => (
                  <DiffFile
                    key={f.key}
                    file={f.diff}
                    label={f.label}
                    notice={f.notice}
                    defaultOpen={startsOpen(f.diff, view.files)}
                    badge={
                      <span className="w-3 shrink-0 font-mono text-[11px] text-fg-3" title={f.file.status.replace('_', ' ')}>
                        {STATUS_LETTER[f.file.status]}
                      </span>
                    }
                  />
                ))}
              </div>
              {g.truncated && <div className="px-1.5 pt-2 text-[12px] text-fg-3">More files changed than are listed here.</div>}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
