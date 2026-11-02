import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editInComposer, getDraft, onFocusRequest, requestFocus, restoreDraft, setDraft } from '../src/components/thread/drafts';

describe('composer drafts', () => {
  beforeEach(() => {
    setDraft('a', '');
    setDraft('b', '');
  });

  it('keeps a draft per thread', () => {
    setDraft('a', 'first');
    setDraft('b', 'second');
    expect(getDraft('a')).toBe('first');
    expect(getDraft('b')).toBe('second');
    expect(getDraft('c')).toBe('');
  });

  it('forgets a draft that is emptied', () => {
    setDraft('a', 'first');
    setDraft('a', '');
    expect(getDraft('a')).toBe('');
  });

  it('puts a restored message in front of a draft typed since', () => {
    setDraft('a', 'typed meanwhile');
    restoreDraft('a', 'failed message');
    expect(getDraft('a')).toBe('failed message\n\ntyped meanwhile');
  });

  it('restores into an empty or blank box without padding', () => {
    restoreDraft('a', 'failed message');
    expect(getDraft('a')).toBe('failed message');
    setDraft('b', '  \n');
    restoreDraft('b', 'failed message');
    expect(getDraft('b')).toBe('failed message');
  });

  it('Edit puts the message in the box and focuses the composer of that thread only', () => {
    const here = vi.fn();
    const elsewhere = vi.fn();
    const stopHere = onFocusRequest('a', here);
    const stopElsewhere = onFocusRequest('b', elsewhere);
    editInComposer('a', 'failed message');
    expect(getDraft('a')).toBe('failed message');
    expect(here).toHaveBeenCalledTimes(1);
    expect(elsewhere).not.toHaveBeenCalled();
    stopHere();
    stopElsewhere();
  });

  it('focuses nothing once the composer is gone, and does not fail', () => {
    const focus = vi.fn();
    onFocusRequest('a', focus)();
    expect(() => requestFocus('a')).not.toThrow();
    expect(focus).not.toHaveBeenCalled();
  });
});
