// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isImeEnter } from '../src/ime.ts';
import { enterKey } from '../src/components/composer/controls.tsx';
import { FolderNameField } from '../src/components/sidebar/FolderRows.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Japanese, Chinese and Korean input: the Enter that confirms a candidate must not send, save or pick. Chromium flags
// it `isComposing`; Safari fires it after compositionend with keyCode 229 and no flag.

/** The keydown an IME's confirming Enter makes, as Chromium (`composing`) or Safari (229) sends it. */
function keydown(target: Element, init: { composing?: boolean; keyCode?: number } = {}) {
  const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: !!init.composing });
  if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  act(() => void target.dispatchEvent(e));
}

describe('isImeEnter', () => {
  it('catches the DOM and React forms of composing, and Safari\'s 229', () => {
    expect(isImeEnter({ isComposing: true })).toBe(true);
    expect(isImeEnter({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeEnter({ keyCode: 229 })).toBe(true);
    expect(isImeEnter({ keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true);
  });

  it('lets a plain Enter through', () => {
    expect(isImeEnter({ keyCode: 13 })).toBe(false);
    expect(isImeEnter({ keyCode: 13, isComposing: false, nativeEvent: { isComposing: false } })).toBe(false);
  });
});

describe('the composer\'s Enter', () => {
  const press = (init: { isComposing?: boolean; keyCode?: number; metaKey?: boolean }) => {
    const preventDefault = vi.fn();
    const e = { key: 'Enter', keyCode: init.keyCode ?? 13, altKey: false, shiftKey: false, ctrlKey: false, metaKey: !!init.metaKey, nativeEvent: { isComposing: !!init.isComposing }, preventDefault };
    return { result: enterKey(e as unknown as ReactKeyboardEvent<HTMLElement>, () => {}), preventDefault };
  };

  it('sends on a plain Enter', () => {
    expect(press({}).result).toBe('send');
  });

  it('does not send on the Enter that confirms an IME candidate, and leaves the key to the IME', () => {
    for (const init of [{ isComposing: true }, { keyCode: 229 }, { keyCode: 229, metaKey: true }]) {
      const { result, preventDefault } = press(init);
      expect(result).toBeNull();
      expect(preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe('a rename field during composition', () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('saves the folder name on Enter, but not on the Enter that confirms a candidate', () => {
    const onSave = vi.fn();
    act(() => root.render(createElement(FolderNameField, { initial: 'にほんご', onSave, onCancel: () => {} })));
    const input = host.querySelector('input')!;
    keydown(input, { composing: true });
    keydown(input, { keyCode: 229 });
    expect(onSave).not.toHaveBeenCalled();
    keydown(input, { keyCode: 13 });
    expect(onSave).toHaveBeenCalledWith('にほんご');
  });
});

// Every Enter handler on a text field checks isImeEnter. A comparison with 'Enter' needs the call on its own line or
// in the few lines above it (the top of the same handler). Real exceptions are listed with why.
const SRC = join(import.meta.dirname, '../src');
const ALLOWED: Record<string, string> = {
  'components/LiveBrowser.tsx': 'maps a key to the text it types into the remote page; the page does its own IME',
  'components/ContextMenuParts.tsx': 'reads a Cmd+Enter shortcut label for a menu row, not a text field',
  'components/ui/slide-confirm.tsx': 'a slider handle, which takes no text',
};
const LOOK_BACK = 6;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Enter handlers', () => {
  it('all check isImeEnter before acting', () => {
    const unguarded: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path);
      if (ALLOWED[rel]) continue;
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\.key\s*[!=]==?\s*['"]Enter['"]/.test(line)) return;
        const handler = lines.slice(Math.max(0, i - LOOK_BACK), i + 1).join('\n');
        if (!handler.includes('isImeEnter(')) unguarded.push(`${rel}:${i + 1}`);
      });
    }
    expect(unguarded).toEqual([]);
  });

  it('lists only exceptions that still have an Enter handler', () => {
    for (const rel of Object.keys(ALLOWED)) expect(readFileSync(join(SRC, rel), 'utf8')).toMatch(/['"]Enter['"]/);
  });
});
