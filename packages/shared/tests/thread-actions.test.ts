import { describe, expect, it } from 'vitest';
import { EVERY_ACTION_FACTS, THREAD_ACTIONS, threadMenu, type ThreadMenuFacts } from '../thread-actions.ts';

const menu = (f: Partial<ThreadMenuFacts> = {}) => threadMenu({ ...EVERY_ACTION_FACTS, ...f });
const ids = (f: Partial<ThreadMenuFacts> = {}) => menu(f).flatMap((g) => g.items.map((i) => i.id));

describe('the thread action menu', () => {
  it('has at most ten actions, in three groups', () => {
    expect(THREAD_ACTIONS.length).toBeLessThanOrEqual(10);
    expect(menu().map((g) => [g.title, g.items.map((i) => i.label)])).toEqual([
      ['Organize', ['Pin thread', 'Mark as done', 'Rename thread', 'Move to folder', 'Archive thread']],
      ['Continue', ['Fork thread', 'Reference a thread']],
      ['Send to', ['Send to Grok Bot']],
    ]);
  });

  it('flips the toggles with the state', () => {
    const labels = menu({ pinned: true, done: true }).flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Unpin thread');
    expect(labels).toContain('Mark as not done');
    expect(menu({ archived: true })[0]!.items.map((i) => i.label)).toEqual(['Mark as done', 'Rename thread', 'Move to folder', 'Unarchive thread']);
  });

  it('offers done only once the turn has ended, or to undo it', () => {
    expect(ids({ settled: false })).not.toContain('done');
    expect(ids({ settled: false, done: true })).toContain('done');
  });

  it('keeps a sub-thread under its parent, out of folders', () => {
    expect(ids({ child: true })).not.toContain('move');
  });

  it('shows Grok Bot only when its webhook is set, and drops the empty Send to group', () => {
    expect(ids({ grokBot: false })).not.toContain('grok');
    expect(menu({ grokBot: false }).map((g) => g.id)).toEqual(['organize', 'continue']);
  });

  it('leaves where the thread runs to the Machine chip', () => {
    expect(THREAD_ACTIONS.map((a) => a.id)).not.toContain('handoff');
    expect(THREAD_ACTIONS.map((a) => a.id)).not.toContain('takeover');
  });

  it('turns Fork off, with the reason, for a thread whose files are elsewhere', () => {
    const fork = menu({ harness: 'hermes' })[1]!.items.find((i) => i.id === 'fork');
    expect(fork?.off).toMatch(/not on this Mac/);
    expect(menu()[1]!.items.find((i) => i.id === 'fork')?.off).toBeUndefined();
  });

  it('waits for the row before the actions that need its state', () => {
    expect(ids({ row: false })).toEqual(['rename', 'archive', 'grok']);
  });
});
