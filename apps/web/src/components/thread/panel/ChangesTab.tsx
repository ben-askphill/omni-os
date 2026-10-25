import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useApi, type BranchChanges, type Thread, type TurnChanges } from '../../../api.ts';
import {
  baseLabel,
  changesView,
  headMove,
  shortSha,
  STATUS_LETTER,
  TURN_NOTE,
  turnChangesView,
  turnStateNote,
  turnTitle,
  type ChangeFileView,
  type ChangeGroupView,
} from '../../../changes.ts';
import { startsOpen } from '../../../diff.ts';
import { clock, plural } from '../../../format.ts';
import { DiffFile, type LineSelect } from '../../DiffViewer.tsx';
import { Empty, ErrorNote, IconButton, Loading, Picker, Segmented } from '../../ui.tsx';
import { SelectionDock, useLineSelection } from './LineSelection.tsx';

type Mode = 'base' | 'turn';

/**
 * The thread's changes, read-only, two ways. Since base: its checkout against the base commit Omni recorded, split
 * into committed, staged, unstaged and untracked. This turn: what one turn changed, between the snapshots Omni saved
 * before and after it. Loads when opened, again when a turn starts or ends, and on Refresh. Lines picked in either
 * go on the thread's next message (LineSelection.tsx).
 */
export function ChangesTab({ thread }: { thread: Thread }) {
  const [mode, setMode] = useState<Mode>('base');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3.5 pb-2.5">
        <Segmented
          size="sm"
          label="Changes to show"
          value={mode}
          onChange={setMode}
          options={[
            { id: 'base', label: 'Since base' },
            { id: 'turn', label: 'This turn' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">{mode === 'base' ? <SinceBase thread={thread} /> : <ThisTurn thread={thread} />}</div>
    </div>
  );
}

/** Reload when the thread starts or ends a turn. */
function useReloadOnStatus(status: Thread['status'], reload: () => void) {
  const last = useRef(status);
  useEffect(() => {
    if (last.current !== status) reload();
    last.current = status;
  }, [status, reload]);
}

function SinceBase({ thread }: { thread: Thread }) {
  const { data, error, loading, reload } = useApi<BranchChanges>(`/threads/${encodeURIComponent(thread.id)}/changes`);
  const view = useMemo(() => (data ? changesView(data) : null), [data]);
  const sel = useLineSelection('base', view?.groups);
  useReloadOnStatus(thread.status, reload);

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
    <div className="flex h-full min-h-0 flex-col" {...sel.root}>
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
          <Groups groups={view.groups} total={view.files} sel={sel} />
        )}
      </div>
      {sel.picked && (
        <SelectionDock threadId={thread.id} picked={sel.picked} source={{ group: sel.picked.group, from: base.sha, to: data.head, turn: null }} onClose={sel.clear} />
      )}
    </div>
  );
}

/** Polls this often while a turn's after snapshot is being saved. */
const SETTLE_POLL_MS = 1500;

function ThisTurn({ thread }: { thread: Thread }) {
  // Null: the newest turn, which moves on as new turns end.
  const [picked, setPicked] = useState<string | null>(null);
  const path = `/threads/${encodeURIComponent(thread.id)}/turns${picked ? `?turn=${encodeURIComponent(picked)}` : ''}`;
  const { data, error, loading, reload } = useApi<TurnChanges>(path);
  const view = useMemo(() => (data ? turnChangesView(data) : null), [data]);
  const sel = useLineSelection(view?.turn.id ?? '', view?.groups);
  useReloadOnStatus(thread.status, reload);

  // The turn ended and its snapshot is still being saved: look again shortly.
  const capturing = view?.turn.state === 'capturing';
  useEffect(() => {
    if (!capturing) return;
    const timer = setTimeout(reload, SETTLE_POLL_MS);
    return () => clearTimeout(timer);
  }, [capturing, data, reload]);

  if (!data) {
    return <div className="px-3">{error ? <ErrorNote onRetry={reload}>{error}</ErrorNote> : <Loading label="Loading this turn" />}</div>;
  }
  if (!data.available || !view) {
    return (
      <div className="scroll-thin h-full overflow-y-auto">
        <Empty icon="diff" title={data.available ? 'No turns saved yet' : 'No turns to show'}>
          {data.reason ?? "Each turn's changes are saved here when it ends."}
        </Empty>
      </div>
    );
  }

  const { turn } = view;
  const note = turnStateNote(turn);
  const moved = headMove(turn);
  return (
    <div className="flex h-full min-h-0 flex-col" {...sel.root}>
      <div className="flex items-start gap-2 px-3.5 pb-2">
        <div className="min-w-0 flex-1">
          <Picker
            label="Turn"
            value={turn.id}
            onChange={(id) => setPicked(id === data.turns[0]?.id ? null : id)}
            options={data.turns.map((t) => ({ value: t.id, label: turnTitle(t), sub: `${clock(new Date(t.started_at))}${t.state === 'ready' ? '' : `, ${t.state}`}`, avatar: false }))}
          />
          {turn.state === 'ready' && (
            <div className="mt-1 font-num text-[11px] text-fg-3">
              {view.files ? (
                <>
                  {plural(view.files, 'file')} <span className="text-fg-2">+{view.additions}</span> <span>-{view.deletions}</span>
                </>
              ) : (
                'No files changed'
              )}
              {moved && (
                <span className="font-mono" title={`HEAD before and after the turn: ${turn.before?.head} → ${turn.after?.head}`}>
                  {' '}
                  · HEAD {moved}
                </span>
              )}
            </div>
          )}
        </div>
        <IconButton icon="refresh" label="Refresh this turn" size={14} onClick={reload} className={loading ? 'opacity-50' : ''} />
      </div>
      <p className="px-3.5 pb-2.5 text-[11.5px] leading-snug text-fg-4">{TURN_NOTE}</p>
      {error && (
        <ErrorNote className="mx-3 mb-2" onRetry={reload}>
          {error}
        </ErrorNote>
      )}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {note ? (
          turn.state === 'failed' ? (
            <ErrorNote className="mx-1">{note}</ErrorNote>
          ) : (
            <Loading label={note} />
          )
        ) : !view.files ? (
          <Empty icon="diff" title="No changes">
            Nothing in the worktree changed during this turn.
          </Empty>
        ) : (
          <Groups groups={view.groups} total={view.files} sel={sel} />
        )}
      </div>
      {sel.picked && turn.before && turn.after && (
        <SelectionDock threadId={thread.id} picked={sel.picked} source={{ group: 'turn', from: turn.before.sha, to: turn.after.sha, turn: turn.id }} onClose={sel.clear} />
      )}
    </div>
  );
}

type Selection = ReturnType<typeof useLineSelection>;

function Groups({ groups, total, sel }: { groups: ChangeGroupView[]; total: number; sel: Selection }) {
  return groups.map((g) => (
    <section key={g.kind} className="mb-4" aria-label={`${g.title} changes`}>
      <div className="flex items-center gap-2 px-1.5 pb-1.5 text-[11.5px] font-medium text-fg-3">
        <span>{g.title}</span>
        <span className="font-num text-fg-4">{g.files.length}</span>
      </div>
      <div className="space-y-2">
        {g.files.map((f) => {
          const on = sel.pick?.file === f.key ? sel.pick : null;
          return <ChangedFileDiff key={f.key} f={f} total={total} from={on?.from} to={on?.to} press={sel.press} />;
        })}
      </div>
      {g.truncated && <div className="px-1.5 pt-2 text-[12px] text-fg-3">More files changed than are listed here.</div>}
    </section>
  ));
}

/** One file, its `select` kept stable while its pick is, so a pick elsewhere does not redraw it. */
const ChangedFileDiff = memo(function ChangedFileDiff({
  f,
  total,
  from,
  to,
  press,
}: {
  f: ChangeFileView;
  total: number;
  from?: number;
  to?: number;
  press: Selection['press'];
}) {
  const select = useMemo<LineSelect | undefined>(
    () => (f.diff.lines.length ? { range: from === undefined || to === undefined ? null : { from, to }, press: (i, extend) => press(f, i, extend) } : undefined),
    [f, from, to, press],
  );
  return (
    <DiffFile
      file={f.diff}
      label={f.label}
      notice={f.notice}
      defaultOpen={startsOpen(f.diff, total)}
      select={select}
      badge={
        <span className="w-3 shrink-0 font-mono text-[11px] text-fg-3" title={f.file.status.replace('_', ' ')}>
          {STATUS_LETTER[f.file.status]}
        </span>
      }
    />
  );
});
