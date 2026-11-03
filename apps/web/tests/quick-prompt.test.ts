import { describe, expect, it } from 'vitest';
import { canSend, CONDUCTOR, dictationSettled, editingHint, quickPromptKey, quickPromptThread, reopened, sentLabel } from '../src/pages/quick-prompt-model.ts';
import { pageTitle, parseHash } from '../src/router.ts';
import { screenOf } from '../src/mobile/screens.ts';

const key = (k: Partial<Parameters<typeof quickPromptKey>[0]>) => quickPromptKey({ key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...k });

// The desktop app's panel opens this route (apps/desktop/src/quick-prompt.ts QUICK_PROMPT_ROUTE).
const QUICK_PROMPT = '#/quick-prompt';

describe('the Quick Prompt route', () => {
  it('is a page of its own that the phone layout has no screen for', () => {
    expect(parseHash(QUICK_PROMPT)).toEqual({ name: 'quick-prompt' });
    expect(parseHash('#/quick-prompt/x')).toEqual({ name: 'notfound', path: '/quick-prompt/x' });
    expect(screenOf(parseHash(QUICK_PROMPT))).toBe('notfound');
    // Only the shell titles a page, and the shell shows this route as not found.
    expect(pageTitle(parseHash(QUICK_PROMPT), () => undefined)).toBe('Omni');
  });
});

describe('the Quick Prompt', () => {
  it('starts a Conductor thread as the Conductor, and a channel thread with no role, marked as a capture', () => {
    expect(quickPromptThread('  plan my week \n', CONDUCTOR)).toEqual({ channel: 'conductor', prompt: 'plan my week', role: 'conductor', source: 'capture' });
    expect(quickPromptThread('fix the header', 'volero')).toEqual({ channel: 'volero', prompt: 'fix the header', source: 'capture' });
    expect(quickPromptThread('   ', CONDUCTOR)).toBeNull();
  });

  it('sends nothing twice, and nothing empty', () => {
    expect(canSend('hi', { kind: 'editing' })).toBe(true);
    expect(canSend('hi', { kind: 'failed', message: 'x' })).toBe(true);
    expect(canSend('hi', { kind: 'sending' })).toBe(false);
    expect(canSend('hi', { kind: 'finishing' })).toBe(false);
    expect(canSend(' ', { kind: 'editing' })).toBe(false);
  });

  it('sends on Return, sends and opens on Cmd or Ctrl-Return, and leaves Shift-Return and composing alone', () => {
    expect(key({})).toBe('send');
    expect(key({ metaKey: true })).toBe('send-open');
    expect(key({ ctrlKey: true })).toBe('send-open');
    expect(key({ shiftKey: true })).toBeNull();
    expect(key({ isComposing: true })).toBeNull();
    expect(key({ keyCode: 229 })).toBeNull();
    expect(key({ key: 'a' })).toBeNull();
  });

  it('waits for Wispr Flow\'s words to land and stay, or gives up', () => {
    const base = { before: '', start: 0, lastEdit: 0 };
    expect(dictationSettled({ ...base, text: '', now: 1000 })).toBe(false);
    expect(dictationSettled({ ...base, text: 'hello', lastEdit: 900, now: 1000 })).toBe(false);
    expect(dictationSettled({ ...base, text: 'hello', lastEdit: 900, now: 1500 })).toBe(true);
    expect(dictationSettled({ ...base, text: '', now: 5000 })).toBe(true);
  });

  it('goes back to the Conductor after a send, and keeps the channel for an unsent draft', () => {
    expect(reopened({ kind: 'sent', thread: { id: 't1', title: '' } }, 'volero')).toEqual({ phase: { kind: 'editing' }, channel: CONDUCTOR });
    expect(reopened({ kind: 'failed', message: 'x' }, 'volero')).toEqual({ phase: { kind: 'editing' }, channel: 'volero' });
  });

  it('says what it started, and which keys do what on each OS', () => {
    expect(sentLabel('Plan the week')).toBe('Started “Plan the week”');
    expect(sentLabel('')).toBe('Started a thread');
    expect(editingHint(true)).toBe('Return to send, ⌘Return to send and open, Esc to close');
    expect(editingHint(false)).toBe('Return to send, Ctrl+Return to send and open, Esc to close');
  });
});
