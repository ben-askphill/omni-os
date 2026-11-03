import { describe, expect, it } from 'vitest';
import type { UpdateView } from '../src/api.ts';
import { clearUpdateMark, markUpdateStarted, reloadAfterUpdate, updateNotice } from '../src/update-notice.ts';

function view(over: Partial<UpdateView> = {}): UpdateView {
  return { current: 'aaa', target: 'bbb', behind: 0, commits: [], checkedAt: null, phase: 'idle', waitingFor: 0, error: null, canApply: true, ...over };
}

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('updateNotice', () => {
  it('shows nothing when level', () => {
    expect(updateNotice(view())).toBeNull();
    expect(updateNotice(null)).toBeNull();
  });

  it('offers Update with the commit count and subjects', () => {
    const n = updateNotice(view({ behind: 3, commits: [{ sha: '1', subject: 'Newest' }, { sha: '2', subject: 'Older' }] }));
    expect(n).toMatchObject({ text: '3 new commits on main', action: 'update', busy: false });
    expect(n?.detail).toBe('Newest\nOlder\nand 1 more');
    expect(updateNotice(view({ behind: 1 }))?.text).toBe('1 new commit on main');
  });

  it('has no button when no app restarts the server', () => {
    const n = updateNotice(view({ behind: 2, canApply: false }));
    expect(n?.action).toBeNull();
    expect(n?.text).toBe('2 new commits on main. Nothing restarts this server, so update it by hand.');
  });

  it('shows progress and its button', () => {
    expect(updateNotice(view({ phase: 'waiting', waitingFor: 2 }))).toMatchObject({ text: 'Waiting for 2 running turns', action: 'cancel', busy: true });
    expect(updateNotice(view({ phase: 'waiting', waitingFor: 1 }))?.text).toBe('Waiting for 1 running turn');
    expect(updateNotice(view({ phase: 'updating' }))).toMatchObject({ text: 'Updating to main and building', action: null });
    expect(updateNotice(view({ phase: 'restarting' }))).toMatchObject({ text: 'Restarting', action: null });
    expect(updateNotice(view({ phase: 'failed', error: 'Updating to main failed. dirty' }))).toMatchObject({ text: 'Updating to main failed. dirty', action: 'dismiss', failed: true });
  });
});

describe('reloadAfterUpdate', () => {
  it('reloads once the server runs another commit, and only once', () => {
    const s = memory();
    markUpdateStarted(s, 'aaa');
    expect(reloadAfterUpdate(s, view({ phase: 'restarting' }))).toBe(false);
    expect(reloadAfterUpdate(s, view({ current: 'bbb' }))).toBe(true);
    expect(reloadAfterUpdate(s, view({ current: 'bbb' }))).toBe(false);
  });

  it('never reloads a page that did not start an update', () => {
    expect(reloadAfterUpdate(memory(), view({ current: 'zzz' }))).toBe(false);
  });

  it('drops the mark when the update fails or is cancelled', () => {
    const s = memory();
    markUpdateStarted(s, 'aaa');
    reloadAfterUpdate(s, view({ phase: 'failed' }));
    expect(s.m.size).toBe(0);
    markUpdateStarted(s, 'aaa');
    clearUpdateMark(s);
    expect(reloadAfterUpdate(s, view({ current: 'bbb' }))).toBe(false);
  });
});
