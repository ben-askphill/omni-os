// Picking lines in a thread's Changes panel to send to the agent: one pick per panel, then a dock to add a note and
// put it on the next message as a diff_selection (packages/shared/message-context-diff.ts), or pin the note to the
// lines as a review note (ReviewNotes.tsx).
import { useCallback, useContext, useMemo, useState, type KeyboardEvent } from 'react';
import { heldPick, holdPress, noPick, pickedLines, type HeldPick, type PickedLines } from '@omni/shared/diff-pick.ts';
import { diffSelection, selectRows, type DiffSelection, type DiffSource } from '@omni/shared/message-context-diff.ts';
import { NOTE_MAX, newContext } from '@omni/shared/message-context.ts';
import type { ChangeFileView, ChangeGroupView } from '@omni/shared/changes-view.ts';
import { errorText } from '../../../api.ts';
import { plural } from '../../../format.ts';
import { addDraftContext } from '../../../message-context/draft.ts';
import { ShellCtx } from '../../../mobile/shell.tsx';
import { Button, ErrorNote, Icon } from '../../ui.tsx';

/**
 * The panel's pick. A new `scope` (another turn) drops it, and so does a reload that changed the picked file's diff,
 * since its indexes would point at other lines.
 */
export function useLineSelection(scope: string, groups: readonly ChangeGroupView[] | undefined) {
  const [held, setHeld] = useState<HeldPick>(noPick(scope));
  const press = useCallback((f: ChangeFileView, i: number, extend: boolean) => setHeld((h) => holdPress(h, scope, f, i, extend)), [scope]);
  const clear = useCallback(() => setHeld(noPick(scope)), [scope]);
  const pick = heldPick(held, scope);
  const picked = useMemo(() => pickedLines(pick, held.diff, groups), [pick, groups, held.diff]);
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
 * Pin note keeps the note on the lines instead, as a review note, and stays on the diff.
 */
export function SelectionDock({
  threadId,
  picked,
  source,
  onClose,
  onPin,
}: {
  threadId: string;
  picked: PickedLines;
  source: Omit<DiffSource, 'blob_old' | 'blob_new'>;
  onClose: () => void;
  onPin?: (anchor: DiffSelection, body: string) => Promise<void>;
}) {
  const shell = useContext(ShellCtx);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
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

  const pin = async () => {
    if (!body.ok || !onPin) return;
    if (!note.trim()) return setError('Write the note to pin first.');
    setPinning(true);
    try {
      await onPin(body.value, note);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPinning(false);
    }
  };

  return (
    <div role="group" aria-label="Selected lines" className="shrink-0 border-t border-line bg-bg px-3 pt-2.5 pb-3">
      <div className="flex items-center gap-2 px-1 text-[12px]">
        <Icon name="diff" size={13} className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-fg-2" title={body.ok ? diffSelection.label(body.value) : undefined}>
          {name ?? 'No lines'}
        </span>
        {body.ok && <span className="shrink-0 font-num text-[11px] text-fg-3">{plural(body.value.rows.length, 'line')}</span>}
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
        <span className="mr-auto hidden min-w-0 truncate pl-1 text-[11.5px] text-fg-3 sm:block">{isMac ? '⌘↵' : 'Ctrl ↵'} add · Esc cancel</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {onPin && (
          <Button size="sm" variant="secondary" icon="pin" title="Keep the note on these lines" disabled={!body.ok || !note.trim()} busy={pinning} onClick={pin}>
            Pin note
          </Button>
        )}
        <Button size="sm" variant="primary" icon="plus" disabled={!body.ok} onClick={add}>
          Add to message
        </Button>
      </div>
    </div>
  );
}
