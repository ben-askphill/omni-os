import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editInComposer, getDraft, onFocusRequest, requestFocus, restoreDraft, setDraft } from '../src/components/thread/drafts';
import { threadKey } from '../src/live/thread-key';

const a = threadKey('mac', 'a');
const b = threadKey('mac', 'b');

describe('composer drafts', () => {
  beforeEach(() => {
    setDraft(a, '');
    setDraft(b, '');
  });

  it('keeps a draft per thread', () => {
    setDraft(a, 'first');
    setDraft(b, 'second');
    expect(getDraft(a)).toBe('first');
    expect(getDraft(b)).toBe('second');
    expect(getDraft(threadKey('mac', 'c'))).toBe('');
  });

  it('forgets a draft that is emptied', () => {
    setDraft(a, 'first');
    setDraft(a, '');
    expect(getDraft(a)).toBe('');
  });

  it('puts a restored message in front of a draft typed since', () => {
    setDraft(a, 'typed meanwhile');
    restoreDraft(a, 'failed message');
    expect(getDraft(a)).toBe('failed message\n\ntyped meanwhile');
  });

  it('restores into an empty or blank box without padding', () => {
    restoreDraft(a, 'failed message');
    expect(getDraft(a)).toBe('failed message');
    setDraft(b, '  \n');
    restoreDraft(b, 'failed message');
    expect(getDraft(b)).toBe('failed message');
  });

  it('Edit puts the message in the box and focuses the composer of that thread only', () => {
    const here = vi.fn();
    const elsewhere = vi.fn();
    const stopHere = onFocusRequest(a, here);
    const stopElsewhere = onFocusRequest(b, elsewhere);
    editInComposer(a, 'failed message');
    expect(getDraft(a)).toBe('failed message');
    expect(here).toHaveBeenCalledTimes(1);
    expect(elsewhere).not.toHaveBeenCalled();
    stopHere();
    stopElsewhere();
  });

  it('focuses nothing once the composer is gone, and does not fail', () => {
    const focus = vi.fn();
    onFocusRequest(a, focus)();
    expect(() => requestFocus(a)).not.toThrow();
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('composer drafts on two servers with the same thread ids', () => {
  // A cloned install keeps its thread ids, so "t1" on the clone is another thread than "t1" on the Mac.
  const onMac = threadKey('mac', 't1');
  const onClone = threadKey('clone', 't1');

  beforeEach(() => {
    setDraft(onMac, '');
    setDraft(onClone, '');
  });

  it('does not show a draft typed for one server on the other', () => {
    setDraft(onMac, 'for the Mac only');
    expect(getDraft(onClone)).toBe('');
    setDraft(onClone, 'for the clone');
    expect(getDraft(onMac)).toBe('for the Mac only');
  });

  it('puts an edited message back on the server it was sent to, and focuses only that composer', () => {
    const mac = vi.fn();
    const clone = vi.fn();
    const stopMac = onFocusRequest(onMac, mac);
    const stopClone = onFocusRequest(onClone, clone);
    editInComposer(onMac, 'failed on the Mac');
    expect(getDraft(onMac)).toBe('failed on the Mac');
    expect(getDraft(onClone)).toBe('');
    expect(mac).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
    stopMac();
    stopClone();
  });

  it('takes a key, never a bare thread id', () => {
    // @ts-expect-error a thread id alone names no server
    expect(getDraft('t1')).toBe('');
  });
});
