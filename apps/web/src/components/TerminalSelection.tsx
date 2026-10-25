// Selecting terminal output to send to the agent: a dock over the terminal's foot while something is selected, to add
// a note and put it on the thread's next message as a terminal_excerpt (packages/shared/message-context-terminal.ts).
// The terminal's own copy and selection are untouched: the dock only reads what is selected. On the phone the terminal is
// read only and has no drag selection, so a tap picks a line and another tap extends the pick, as in the Changes panel.
import { useContext, useEffect, useState, type RefObject } from 'react';
import type { IDisposable, Terminal } from '@xterm/xterm';
import { NOTE_MAX, newContext } from '@omni/shared/message-context.ts';
import { plainText, selectExcerpt, terminalExcerpt } from '@omni/shared/message-context-terminal.ts';
import { api } from '../api.ts';
import { plural } from '../format.ts';
import { addDraftContext } from '../message-context/draft.ts';
import { ShellCtx } from '../mobile/shell.tsx';
import { Button, ErrorNote, Icon } from './ui.tsx';

export const SELECTION_GONE = 'The selection is gone. Select the output again.';

/** What is selected in `term` now, as plain text; empty when nothing is. */
export const selectedText = (term: Terminal) => (term.hasSelection() ? plainText(term.getSelection()) : '');

/** The selection's text, kept up to date: the dock's open state and its line count. */
export function useSelectedText(term: RefObject<Terminal | null>, attached: unknown) {
  const [text, setText] = useState('');
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    const sub: IDisposable = t.onSelectionChange(() => setText(selectedText(t)));
    return () => {
      sub.dispose();
      setText('');
    };
  }, [term, attached]);
  return text;
}

/**
 * Taps on a read-only terminal as line picks: a tap selects its line, a tap on another extends the pick from the
 * first, a tap on the only picked line clears it. Mouse and keyboard are left to xterm, so a drag selects as usual.
 */
export function useTapToPick(term: RefObject<Terminal | null>, host: RefObject<HTMLElement | null>, enabled: boolean, attached: unknown) {
  useEffect(() => {
    const el = host.current;
    const t = term.current;
    if (!enabled || !el || !t) return;
    let pick: { from: number; to: number } | null = null;
    let touched = false;
    const down = (e: PointerEvent) => void (touched = e.pointerType === 'touch' || e.pointerType === 'pen');
    const click = (e: MouseEvent) => {
      if (!touched) return;
      const rows = el.querySelector<HTMLElement>('.xterm-rows');
      const height = rows?.firstElementChild?.getBoundingClientRect().height;
      if (!rows || !height) return;
      const line = t.buffer.active.viewportY + Math.floor((e.clientY - rows.getBoundingClientRect().top) / height);
      if (line < 0 || line >= t.buffer.active.length) return;
      if (!pick || !t.hasSelection()) pick = { from: line, to: line };
      else if (pick.from === line && pick.to === line) {
        t.clearSelection();
        pick = null;
        return;
      } else pick = { from: pick.from, to: line };
      t.selectLines(Math.min(pick.from, pick.to), Math.max(pick.from, pick.to));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('click', click);
    };
  }, [term, host, enabled, attached]);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Over the terminal's foot while output is selected. Add to message takes what is selected at that moment, with the
 * shell's pid and the time, and puts it on the next message. Then the phone goes back to the thread, where the
 * composer shows it; the desktop focuses the reply box.
 */
export function TerminalSelectionDock({ threadId, cwd, term, text }: { threadId: string; cwd: string; term: RefObject<Terminal | null>; text: string }) {
  const shell = useContext(ShellCtx);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lines = text ? text.split('\n').length : 0;

  // A new selection is a new question: an old refusal no longer applies.
  useEffect(() => setError(null), [text]);
  if (!text && !error) return null;

  const add = async () => {
    const t = term.current;
    const at = new Date();
    const picked = t ? selectedText(t) : '';
    if (!picked) return setError(SELECTION_GONE);
    // The shell's pid says which shell this was after a restart. Not worth refusing for when the server can't say.
    const pid = await api
      .get<{ pid?: number }>(`/threads/${encodeURIComponent(threadId)}/terminal`)
      .then((i) => (typeof i.pid === 'number' ? i.pid : null))
      .catch(() => null);
    const body = selectExcerpt(picked, { thread: threadId, pid, cwd, at });
    if (!body.ok) return setError(body.error);
    const why = addDraftContext(threadId, newContext(terminalExcerpt, body.value, note));
    if (why) return setError(why);
    t?.clearSelection();
    setNote('');
    if (shell) shell.back();
    else document.querySelector<HTMLTextAreaElement>('textarea[data-reply-composer]')?.focus();
  };

  return (
    <div role="group" aria-label="Selected output" className="absolute inset-x-2 bottom-2 z-10 rounded-2xl bg-bg px-3 pt-2.5 pb-3 shadow-[0_8px_28px_rgba(0,0,0,0.35),inset_0_0_0_1px_var(--line-strong)]">
      <div className="flex items-center gap-2 px-1 text-[12px]">
        <Icon name="terminal" size={13} className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-fg-2">{lines ? `${plural(lines, 'line')} selected` : 'Nothing selected'}</span>
        {error ? null : <span className="hidden shrink-0 text-[11.5px] text-fg-4 sm:inline">{isMac ? '⌘C' : 'Ctrl C'} still copies</span>}
      </div>
      <textarea
        value={note}
        maxLength={NOTE_MAX}
        rows={1}
        aria-label="Note for the agent"
        placeholder="Add a note (optional)"
        onChange={(e) => {
          setNote(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            term.current?.clearSelection();
            term.current?.focus();
          }
        }}
        className="mt-2 block w-full resize-none rounded-xl bg-surface px-3 py-2 text-[16px] leading-[1.45] outline-none placeholder:text-fg-4 focus:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:text-[13px]"
      />
      {error && <ErrorNote className="mt-2">{error}</ErrorNote>}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            term.current?.clearSelection();
            setError(null);
          }}
        >
          Clear
        </Button>
        <Button size="sm" variant="primary" icon="plus" disabled={!text} onClick={() => void add()}>
          Add to message
        </Button>
      </div>
    </div>
  );
}
