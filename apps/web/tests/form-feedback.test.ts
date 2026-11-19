// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button, CheckItem, copyText, CopyButton, fieldDescribedBy, Label, useFieldErrors } from '../src/components/ui.tsx';

// The shared form and feedback primitives (W9 of docs/plans/2026-11-19-modern-web-fixes.md): copy reports what really
// happened, a Label's hint describes its field instead of naming it, a field is marked invalid only once its message
// shows, a to-do row is a list item and not a control, and a busy button keeps focus.

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (el: Parameters<Root['render']>[0]) => act(() => root.render(el));
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const click = (el: HTMLElement) => act(async () => el.click());

/** No async Clipboard API (plain http), and execCommand('copy') answering `ok`. Reports the field it copied from. */
function plainHttp(ok: boolean) {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
  const seen: { readOnly: boolean; fontSize: string; value: string }[] = [];
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: () => {
      const ta = document.querySelector('textarea')!;
      seen.push({ readOnly: ta.readOnly, fontSize: ta.style.fontSize, value: ta.value });
      return ok;
    },
  });
  return seen;
}

describe('copyText', () => {
  it('is true when the async Clipboard API takes the text', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it("over plain http copies from a readonly 16px field, so iOS neither raises the keyboard nor zooms", async () => {
    const seen = plainHttp(true);
    expect(await copyText('token')).toBe(true);
    expect(seen).toEqual([{ readOnly: true, fontSize: '16px', value: 'token' }]);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it("is false when execCommand('copy') refuses too", async () => {
    plainHttp(false);
    expect(await copyText('token')).toBe(false);
  });
});

describe('CopyButton', () => {
  it('says and announces Copied when the copy worked', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } });
    render(createElement(CopyButton, { text: 'x' }));
    await click($('button'));
    expect($('button').textContent).toBe('Copied');
    expect($('[role="status"]').textContent).toBe('Copied');
  });

  it("says and announces Couldn't copy when it failed, from a live region outside the button", async () => {
    plainHttp(false);
    render(createElement(CopyButton, { text: 'x' }));
    const status = $('[role="status"]');
    expect(status.textContent).toBe('');
    expect($('button').contains(status)).toBe(false);
    await click($('button'));
    expect($('button').textContent).toBe("Couldn't copy");
    expect(status.textContent).toBe("Couldn't copy");
  });
});

describe('Label', () => {
  it('names the field with the label text only; the hint describes it', () => {
    render(
      createElement('div', null, [
        createElement(Label, { key: 'l', htmlFor: 'pair-token', hint: 'On the machine that runs Omni: cat data/api-token', children: 'Token' }),
        createElement('input', { key: 'i', id: 'pair-token', 'aria-describedby': fieldDescribedBy('pair-token', { hint: true }) }),
      ]),
    );
    const label = $<HTMLLabelElement>('label');
    expect(label.htmlFor).toBe('pair-token');
    expect(label.textContent).toBe('Token');
    const hint = document.getElementById($('input').getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toBe('On the machine that runs Omni: cat data/api-token');
    expect(label.contains(hint)).toBe(false);
  });

  it('is plain text, not a <label>, when there is no control to name', () => {
    render(createElement(Label, { hint: 'Pick any.', children: 'Which tools do you use?' }));
    expect(host.querySelector('label')).toBeNull();
  });
});

/** A one-field form: Name, required. Submit says whether it got through. */
function NameForm({ onSent }: { onSent: () => void }) {
  const [name, setName] = useState('');
  const problems = useFieldErrors({ 'f-name': name.trim() ? null : 'Give it a name.', 'f-note': null });
  const error = problems.error('f-name');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!problems.submit()) onSent();
  };
  return createElement('form', { onSubmit: submit, noValidate: true }, [
    createElement('input', { key: 'note', id: 'f-note' }),
    createElement(Label, { key: 'l', htmlFor: 'f-name', error, children: 'Name' }),
    createElement('input', {
      key: 'i',
      id: 'f-name',
      required: true,
      value: name,
      onChange: (e: { target: HTMLInputElement }) => setName(e.target.value),
      onBlur: problems.onBlur,
      'aria-invalid': problems.invalid('f-name'),
      'aria-describedby': fieldDescribedBy('f-name', { error }),
    }),
    createElement('button', { key: 'b', type: 'submit' }, 'Save'),
  ]);
}

const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const blur = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

describe('useFieldErrors', () => {
  it('leaves an untouched field unmarked, and a field left empty waits for the submit', () => {
    render(createElement(NameForm, { onSent: () => {} }));
    const input = $<HTMLInputElement>('#f-name');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    blur(input);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('f-name-error')).toBeNull();
  });

  it('marks the field and shows its message together on submit, focuses it, and clears both once fixed', async () => {
    const sent = vi.fn();
    render(createElement(NameForm, { onSent: sent }));
    const input = $<HTMLInputElement>('#f-name');
    await click($('button'));
    expect(sent).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('f-name-error');
    expect(document.getElementById('f-name-error')!.textContent).toBe('Give it a name.');
    expect(document.activeElement).toBe(input);
    await type(input, 'Acme');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('f-name-error')).toBeNull();
    await click($('button'));
    expect(sent).toHaveBeenCalledOnce();
  });

  it('waits for a click under way, so the message does not move Submit out from under it', async () => {
    const sent = vi.fn();
    render(createElement(NameForm, { onSent: sent }));
    const input = $<HTMLInputElement>('#f-name');
    await type(input, ' ');
    act(() => void window.dispatchEvent(new Event('pointerdown')));
    blur(input);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the problem of a field left with something in it', async () => {
    render(createElement(NameForm, { onSent: () => {} }));
    const input = $<HTMLInputElement>('#f-name');
    await type(input, ' ');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    blur(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('CheckItem', () => {
  it('is a list item with its state in words, and no Tab stop', () => {
    render(
      createElement('ul', null, [
        createElement(CheckItem, { key: 'a', state: 'completed', children: 'Write the tests' }),
        createElement(CheckItem, { key: 'b', state: 'in_progress', children: 'Fix the copy button' }),
      ]),
    );
    const rows = [...host.querySelectorAll('li')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.hasAttribute('role')).toBe(false);
      expect(row.hasAttribute('tabindex')).toBe(false);
    }
    expect(rows.map((r) => r.textContent)).toEqual(['Done: Write the tests', 'In progress: Fix the copy button']);
  });
});

describe('Button busy', () => {
  it('keeps focus and ignores clicks while busy, then works again', async () => {
    const onClick = vi.fn();
    const draw = (busy: boolean) => render(createElement(Button, { busy, onClick }, 'Save'));
    draw(false);
    const button = $<HTMLButtonElement>('button');
    act(() => button.focus());
    draw(true);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(button);
    await click(button);
    expect(onClick).not.toHaveBeenCalled();
    draw(false);
    await click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not submit its form while busy', async () => {
    const submit = vi.fn((e: FormEvent) => e.preventDefault());
    render(createElement('form', { onSubmit: submit }, createElement(Button, { type: 'submit', busy: true }, 'Save')));
    await click($('button'));
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('native constraints', () => {
  // `required` and `pattern` give a field its semantics, but a form that validates natively stops the submit with the
  // browser's own bubble before useFieldErrors can show its message and move focus. So such a form is noValidate.
  const SRC = join(import.meta.dirname, '../src');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));

  it('sit only in files whose forms are noValidate', () => {
    const offenders = files(SRC).filter((path) => {
      const src = readFileSync(path, 'utf8');
      return /<(?:input|textarea|select)\b[^>]*\s(?:required|pattern=)/.test(src) && /<form\b/.test(src) && !/<form\b[^>]*noValidate/.test(src);
    });
    expect(offenders.map((p) => relative(SRC, p))).toEqual([]);
  });
});
