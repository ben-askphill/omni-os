// Picking lines in a thread's Changes panel to send to the agent: one pick per panel, then a dock to add a note and
// put it on the next message as a diff_selection (packages/shared/message-context-diff.ts).
import { useCallback, useContext, useMemo, useState, type KeyboardEvent } from 'react';
import { clampToHunk, diffSelection, selectRows, type DiffFileLike, type DiffLineLike, type DiffSource } from '@omni/shared/message-context-diff.ts';
import { NOTE_MAX, newContext } from '@omni/shared/message-context.ts';
import type { ChangeKind } from '../../../api.ts';
import type { ChangeFileView, ChangeGroupView } from '../../../changes.ts';
import { plural } from '../../../format.ts';
import { addDraftContext } from '../../../message-context/draft.ts';
import { ShellCtx } from '../../../mobile/shell.tsx';
import { Button, ErrorNote, Icon } from '../../ui.tsx';

/** Lines `from`..`to` of one file, as indexes into its lines. `to` may be above `from`. */
export interface LinePick {
  file: string;
  from: number;
  to: number;
}

/**
 * The pick after a press on line `i` of `file`. Extending moves `to`, within the hunk `from` is in; a press past
 * that hunk, in another file, or without `extend` starts a new pick. Pressing the only picked line clears it.
 */
export function pressLine(pick: LinePick | null, file: string, lines: readonly DiffLineLike[], i: number, extend: boolean): LinePick | null {
  const mine = pick?.file === file ? pick : null;
  if (mine && mine.from === i && mine.to === i) return null;
  if (extend && mine && clampToHunk(lines, mine.from, i).to === i) return { file, from: mine.from, to: i };
  return { file, from: i, to: i };
}

/** The picked file, ready for `selectRows`. */
export interface PickedLines {
  group: ChangeKind;
  file: DiffFileLike;
  from: number;
  to: number;
}

/**
 * The panel's pick. A new `scope` (another turn) drops it, and so does a reload that changed the picked file's diff,
 * since its indexes would point at other lines.
 */
export function useLineSelection(scope: string, groups: readonly ChangeGroupView[] | undefined) {
  const [held, setHeld] = useState<{ scope: string; pick: LinePick | null; diff: string }>({ scope, pick: null, diff: '' });
  const press = useCallback(
    (f: ChangeFileView, i: number, extend: boolean) =>
      setHeld((h) => ({ scope, pick: pressLine(h.scope === scope ? h.pick : null, f.key, f.diff.lines, i, extend), diff: f.file.diff })),
    [scope],
  );
  const clear = useCallback(() => setHeld({ scope, pick: null, diff: '' }), [scope]);
  const pick = held.scope === scope ? held.pick : null;
  const picked = useMemo((): PickedLines | null => {
    if (!pick) return null;
    for (const g of groups ?? []) {
      const f = g.files.find((x) => x.key === pick.file && x.file.diff === held.diff);
      if (f) return { group: g.kind, file: { path: f.diff.path, old_path: f.file.old_path, header: f.diff.header, lines: f.diff.lines }, from: pick.from, to: pick.to };
    }
    return null;
  }, [pick, groups, held.diff]);
  /** For the panel's root: Esc there clears the pick instead of interrupting the thread (useThreadInterruptKey). */
  const root = {
    'data-keeps-esc': picked ? '' : undefined,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !picked || e.nativeEvent.isComposing) return;
      e.preventDefault();
      clear();
    },
  };
  return { pick: picked ? pick : null, picked, press, clear, root };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Under the diff while lines are picked: what they are, a note, and Add to message, which puts them on the thread's
 * next message. Then the phone goes back to the thread, where the composer shows them; the desktop focuses it.
 */
export function SelectionDock({
  threadId,
  picked,
  source,
  onClose,
}: {
  threadId: string;
  picked: PickedLines;
  source: Omit<DiffSource, 'blob_old' | 'blob_new'>;
  onClose: () => void;
}) {
  const shell = useContext(ShellCtx);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const body = useMemo(() => selectRows(picked.file, picked.from, picked.to, source), [picked, source]);
  const name = body.ok ? diffSelection.label({ ...body.value, path: body.value.path.split('/').pop() ?? body.value.path }) : null;

  const add = () => {
    if (!body.ok) return;
    const why = addDraftContext(threadId, newContext(diffSelection, body.value, note));
    if (why) return setError(why);
    onClose();
    if (shell) shell.back();
    else document.querySelector<HTMLTextAreaElement>('textarea[data-reply-composer]')?.focus();
  };

  return (
    <div role="group" aria-label="Selected lines" className="shrink-0 border-t border-line bg-bg px-3 pt-2.5 pb-3">
      <div className="flex items-center gap-2 px-1 text-[12px]">
        <Icon name="diff" size={13} className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-fg-2" title={body.ok ? diffSelection.label(body.value) : undefined}>
          {name ?? 'No lines'}
        </span>
        {body.ok && <span className="shrink-0 font-num text-[11px] text-fg-4">{plural(body.value.rows.length, 'line')}</span>}
      </div>
      <textarea
        value={note}
        maxLength={NOTE_MAX}
        rows={2}
        aria-label="Note for the agent"
        placeholder="Add a note (optional)"
        onChange={(e) => {
          setNote(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        className="mt-2 block w-full resize-none rounded-xl bg-surface px-3 py-2 text-[16px] leading-[1.45] outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[13px]"
      />
      {(error || !body.ok) && <ErrorNote className="mt-2">{error ?? (!body.ok && body.error)}</ErrorNote>}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <span className="mr-auto hidden pl-1 text-[11.5px] text-fg-4 sm:inline">{isMac ? '⌘↵' : 'Ctrl ↵'} add · Esc cancel</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon="plus" disabled={!body.ok} onClick={add}>
          Add to message
        </Button>
      </div>
    </div>
  );
}
