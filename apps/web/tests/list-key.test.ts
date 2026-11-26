// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isListToggleKey } from '../src/list-key.ts';

const key = (over: Partial<Parameters<typeof isListToggleKey>[0]> = {}) => ({
  key: '\\',
  code: 'Backslash',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  target: document.body,
  ...over,
});

describe('isListToggleKey', () => {
  it('is Cmd+\\ on a Mac and Ctrl+\\ elsewhere', () => {
    expect(isListToggleKey(key({ metaKey: true }), true)).toBe(true);
    expect(isListToggleKey(key({ ctrlKey: true }), true)).toBe(false);
    expect(isListToggleKey(key({ ctrlKey: true }), false)).toBe(true);
    expect(isListToggleKey(key({ metaKey: true }), false)).toBe(false);
    expect(isListToggleKey(key(), false)).toBe(false);
  });

  it('matches the Backslash key on a layout that types another character', () => {
    expect(isListToggleKey(key({ ctrlKey: true, key: '§' }), false)).toBe(true);
    expect(isListToggleKey(key({ ctrlKey: true, key: 'a', code: 'KeyA' }), false)).toBe(false);
  });

  it('leaves Alt and Shift chords alone, and a composing IME', () => {
    expect(isListToggleKey(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isListToggleKey(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isListToggleKey(key({ ctrlKey: true, isComposing: true }), false)).toBe(false);
  });

  it("leaves Ctrl+\\ to the terminal, where it is SIGQUIT, but not Cmd+\\", () => {
    const term = document.createElement('div');
    term.className = 'xterm';
    const input = document.createElement('textarea');
    term.append(input);
    document.body.append(term);
    expect(isListToggleKey(key({ ctrlKey: true, target: input }), false)).toBe(false);
    expect(isListToggleKey(key({ metaKey: true, target: input }), true)).toBe(true);
  });
});
