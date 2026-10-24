// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { diffSelection } from '@omni/shared/message-context-diff.ts';
import { CONTEXT_KINDS } from '@omni/shared/message-context-kinds.ts';
import { terminalExcerpt, type TerminalExcerpt } from '@omni/shared/message-context-terminal.ts';
import { SELECTION_GONE, TerminalSelectionDock } from '../src/components/TerminalSelection.tsx';
import { ContextChips } from '../src/message-context/ContextChips.tsx';
import { addDraftContext, draftContext, removeDraftContext, settleDraftContext } from '../src/message-context/draft.ts';
import { CONTEXT_VIEWS } from '../src/message-context/kinds.ts';
import { ShellCtx } from '../src/mobile/shell.tsx';

// The Web UI's half of terminal context: the dock over the terminal while output is selected, and how its record shows.
// The dock is driven with a stand-in for xterm's selection calls, so what it reads and clears is what is checked.

const THREAD = '5c1a7e92-4b3d-4f60-8a1e-9d2c3b4a5f60';
const CWD = '/Users/ben/code/shop';
const OUTPUT = '$ npm test\n FAIL  src/cart.test.ts\n  \u2715 totals an empty cart (4 ms)';
const known: MessageContext<'terminal_excerpt', TerminalExcerpt> = {
  id: 'b7e2c9d4-6a1f-4c83-9e50-1f3a8d2b6c47',
  kind: 'terminal_excerpt',
  v: 1,
  label: 'Terminal, 3 lines: $ npm test',
  note: 'why does the second test fail?',
  body: { thread: THREAD, pid: 48213, cwd: CWD, captured_at: '2026-10-24T09:30:15.250Z', lines: 3, text: OUTPUT },
};

let root: Root;
let host: HTMLDivElement;
let selection: string | null;
let cleared: number;
let shellPid: number | null | 'down';

const term = {
  current: {
    hasSelection: () => selection !== null,
    getSelection: () => selection ?? '',
    clearSelection: () => {
      selection = null;
      cleared++;
    },
    focus: () => {},
  },
} as never;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  selection = OUTPUT;
  cleared = 0;
  shellPid = 48213;
  settleDraftContext(THREAD, draftContext(THREAD).map((r) => r.id));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `/api/threads/${THREAD}/terminal`) {
        if (shellPid === 'down') throw new Error('offline');
        return Response.json(shellPid === null ? { open: false, running: false, code: null } : { open: true, running: false, code: 0, cwd: CWD, pid: shellPid });
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = (text: string | null, back?: () => void) =>
  act(async () => {
    const dock = createElement(TerminalSelectionDock, { threadId: THREAD, cwd: CWD, term, text: text ?? '' });
    root.render(back ? createElement(ShellCtx.Provider, { value: { back } as never }, dock) : dock);
  });
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
const press = (name: string) => act(async () => void button(name).click());
const typeNote = (value: string) =>
  act(async () => {
    const input = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('the dock', () => {
  it('is not there until something is selected', async () => {
    await mount(null);
    expect(host.textContent).toBe('');
    await mount(selection);
    expect(host.textContent).toContain('3 lines selected');
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Selected output');
  });

  it('puts the selection, the shell and the time on the next message, next to what is already there', async () => {
    const before = newContext(diffSelection, { path: 'a.ts', old_path: null, side: 'new', start: 1, end: 1, rows: [{ kind: 'add', text: 'x', old: null, new: 1 }], source: { group: 'unstaged', from: 'a', to: 'b', turn: null, blob_old: null, blob_new: null } }, '', { id: () => 'diff-1' });
    expect(addDraftContext(THREAD, before)).toBeNull();
    await mount(selection);
    await typeNote('why does the second test fail?');
    await press('Add to message');
    const [first, added] = draftContext(THREAD);
    expect(first).toEqual(before);
    expect(added).toMatchObject({ kind: 'terminal_excerpt', v: 1, note: 'why does the second test fail?', label: 'Terminal, 3 lines: $ npm test' });
    expect(added.body).toMatchObject({ thread: THREAD, pid: 48213, cwd: CWD, lines: 3, text: OUTPUT });
    expect((added.body as TerminalExcerpt).captured_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(cleared).toBe(1);
  });

  it('still adds it when the shell has gone, with no pid when the server cannot say', async () => {
    shellPid = null;
    await mount(selection);
    await press('Add to message');
    expect((draftContext(THREAD)[0].body as TerminalExcerpt).pid).toBeNull();
    removeDraftContext(THREAD, draftContext(THREAD)[0].id);
    shellPid = 'down';
    selection = OUTPUT;
    await mount(selection);
    await press('Add to message');
    expect((draftContext(THREAD)[0].body as TerminalExcerpt).pid).toBeNull();
  });

  it('says so when the selection is gone, and adds nothing', async () => {
    await mount(selection);
    selection = null;
    await press('Add to message');
    expect(host.textContent).toContain(SELECTION_GONE);
    expect(draftContext(THREAD)).toEqual([]);
  });

  it('refuses more than a message should carry, and says how much', async () => {
    selection = Array.from({ length: 201 }, (_, i) => `line ${i}`).join('\n');
    await mount(selection);
    await press('Add to message');
    expect(host.textContent).toContain('Select at most 200 lines.');
    selection = 'y'.repeat(8001);
    await mount(selection);
    await press('Add to message');
    expect(host.textContent).toContain('Select at most 8000 characters.');
    expect(draftContext(THREAD)).toEqual([]);
  });

  it('strips escape sequences from the selection before it is a record', async () => {
    selection = '\u001b[31mFAIL\u001b[0m \u001b]0;x\u0007src/cart.test.ts';
    await mount(selection);
    await press('Add to message');
    expect((draftContext(THREAD)[0].body as TerminalExcerpt).text).toBe('FAIL src/cart.test.ts');
  });

  it('takes the phone back to the thread, where the composer shows the chip', async () => {
    const back = vi.fn();
    await mount(selection, back);
    await press('Add to message');
    expect(back).toHaveBeenCalledOnce();
    expect(draftContext(THREAD)).toHaveLength(1);
  });

  it('clears the selection without adding on Clear', async () => {
    await mount(selection);
    await press('Clear');
    expect(cleared).toBe(1);
    expect(draftContext(THREAD)).toEqual([]);
  });
});

describe('the record in the composer and the transcript', () => {
  it('has a view, and its chip and inspector show the output and where it came from', async () => {
    expect(Object.keys(CONTEXT_VIEWS)).toEqual(Object.keys(CONTEXT_KINDS));
    expect(CONTEXT_VIEWS.terminal_excerpt.icon).toBe('terminal');
    await act(async () => root.render(createElement(ContextChips, { records: [known], onRemove: () => {} })));
    expect(host.textContent).toContain('Terminal, 3 lines: $ npm test');
    await act(async () => void host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    const shown = host.querySelector('[role="region"]')!.textContent!;
    expect(shown).toContain('3 lines selected');
    expect(shown).toContain('shell pid 48213');
    expect(shown).toContain('✕ totals an empty cart (4 ms)');
    expect(shown).toContain('why does the second test fail?');
  });

  it('is the record that was added: the same after the terminal moves on', () => {
    const rec = newContext(terminalExcerpt, known.body, '', { id: () => 'term-9' });
    const copy = JSON.parse(JSON.stringify(rec));
    expect(copy).toEqual(rec);
    expect(Object.isFrozen(rec)).toBe(false);
  });
});
