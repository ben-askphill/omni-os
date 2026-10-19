import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PendingMsg, ThreadDetail } from '../src/api.ts';
import { isOmnis, isParked, parkedHeading, parkedLabel, parkedOf, reportNotes, requestIdFor, sendKey } from '../src/requests.ts';
import { isEditable, movedOrder } from '../src/pending-edits.ts';

// The Web UI's side of durable sends (apps/web/src/requests.ts), against the same recorded server answers the Mac app's
// Swift tests decode (apps/server/tests/mac-fixtures.test.ts records them).

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

describe('request ids', () => {
  it('keeps one id across retries of the same message, and makes a new one for anything else', () => {
    let n = 0;
    const make = () => `id-${++n}`;
    const file = { name: 'a.png', size: 10, lastModified: 1 };
    const first = requestIdFor(null, sendKey('hi', 'queue', [file]), make);
    expect(first.id).toBe('id-1');
    expect(requestIdFor(first, sendKey('hi', 'queue', [file]), make)).toBe(first);
    expect(requestIdFor(first, sendKey('hi', 'steer', [file]), make).id).toBe('id-2');
    expect(requestIdFor(first, sendKey('hi!', 'queue', [file]), make).id).toBe('id-3');
    expect(requestIdFor(first, sendKey('hi', 'queue', []), make).id).toBe('id-4');
    expect(requestIdFor(first, sendKey('hi', 'queue', [{ ...file, size: 11 }]), make).id).toBe('id-5');
  });

  it('makes uuids by default', () => {
    expect(requestIdFor(null, 'k').id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is what the Mac app sends: the recorded queued message carries its request id', () => {
    expect(fixture<Record<string, string>>('message-queued-request.json')).toEqual({ prompt: 'then write it up', mode: 'queue', request_id: 'req-1' });
  });
});

describe('messages a restart parked', () => {
  it('reads the recovery state the server sends after a restart', () => {
    const d = fixture<ThreadDetail>('thread-recovered.json');
    const pending = d.pending ?? [];
    expect(pending.map((m) => [m.state, m.delivery, m.request_id])).toEqual([
      ['held', 'recovered', 'req-1'],
      ['held', 'uncertain', 'req-2'],
    ]);
    expect(pending.every(isParked)).toBe(true);
    const { recovered, uncertain } = parkedOf(pending);
    expect(recovered.map((m) => m.text)).toEqual(['then write it up']);
    expect(uncertain.map((m) => m.text)).toEqual(['and check the totals']);
    expect(pending.map(parkedLabel)).toEqual(['Held after a restart, waiting for Resume', 'May have reached the agent before the restart']);
  });

  it("treats the runner's own messages as not parked, with or without a request id", () => {
    const busy = fixture<ThreadDetail>('thread.json').pending ?? [];
    expect(busy).toHaveLength(1);
    expect(busy[0].delivery).toBe('held');
    expect(busy.some(isParked)).toBe(false);
    expect(parkedLabel(busy[0])).toBeNull();
    const old: PendingMsg = { uuid: 'u', kind: 'user', text: 'x', mode: 'steer', state: 'held' };
    expect(isParked(old)).toBe(false);
  });

  it("reads a resume answer: the resumed one is the runner's own again, the uncertain one still waits", () => {
    const answer = fixture<{ thread: { id: string }; pending: PendingMsg[] }>('requests-resumed.json');
    expect(answer.pending.map((m) => [m.request_id, isParked(m)])).toEqual([
      ['req-1', false],
      ['req-2', true],
    ]);
  });
});

describe('crew reports held for the parent', () => {
  it('reads a report kept for a stopped parent: held for Resume, not editable, noted on the delegation row', () => {
    const d = fixture<ThreadDetail>('thread-report-held.json');
    expect(d.thread.status).toBe('stopped');
    const pending = d.pending ?? [];
    expect(pending).toHaveLength(1);
    const [r] = pending;
    expect(r).toMatchObject({ kind: 'crew_report', state: 'held', delivery: 'recovered', text: 'ack: TOOL:300 check the stock' });
    expect(r.thread_id).toBeTruthy();
    expect(isParked(r)).toBe(true);
    expect(isOmnis(r)).toBe(true);
    expect(isEditable(r)).toBe(false);
    expect(parkedOf(pending).recovered).toEqual([r]);
    expect(parkedLabel(r)).toBe(`Crew report ${r.task_id}, held for Resume`);
    expect(parkedHeading(pending)).toBe('1 crew report is waiting for Resume');
    expect(reportNotes(pending)).toEqual(new Map([[r.thread_id!, 'report held for Resume']]));
  });

  it("says where each unread report is, and leaves Omni's messages out of Ben's reorder", () => {
    const base = { mode: 'steer' as const, text: 'x' };
    const items: PendingMsg[] = [
      { ...base, uuid: 'a', kind: 'crew_report', state: 'sent', thread_id: 't1', request_id: 'r1', delivery: 'sent' },
      { ...base, uuid: 'b', kind: 'crew_report', state: 'waiting', thread_id: 't2', request_id: 'r2', delivery: 'waiting' },
      { ...base, uuid: 'c', kind: 'crew_report', state: 'held', thread_id: 't3', request_id: 'r3', delivery: 'uncertain', role: 'coder', task_id: 'T-3' },
      { ...base, uuid: 'd', kind: 'user', source: 'team', state: 'held', request_id: 'r4', delivery: 'recovered' },
      { ...base, uuid: 'e', kind: 'user', source: 'ben', state: 'held', request_id: 'r5', delivery: 'recovered' },
      { ...base, uuid: 'f', kind: 'user', source: 'ben', state: 'held', request_id: 'r6', delivery: 'recovered' },
    ];
    expect([...reportNotes(items)]).toEqual([
      ['t1', 'report on its way'],
      ['t2', 'report waiting for a slot'],
      ['t3', 'report may not have arrived'],
    ]);
    expect(parkedLabel(items[2])).toBe('Crew report T-3 from coder, may have reached the agent before the restart');
    expect(items.filter(isEditable).map((m) => m.uuid)).toEqual(['e', 'f']);
    expect(movedOrder(items, 'f', -1)).toEqual(['f', 'e']);
    expect(parkedHeading(items.slice(2))).toBe('4 messages and crew reports are waiting for Resume');
    expect(parkedHeading(items.slice(4))).toBe('2 messages were waiting when Omni restarted');
  });
});

describe('a worktree that could not be prepared', () => {
  const failed = fixture<ThreadDetail & { blocked?: string }>('thread-setup-failed.json');

  it('reads the setup state, the reason and the first prompt the server keeps for Retry', () => {
    expect(failed.thread.setup).toBe('failed');
    expect(failed.thread.setup_error).toMatch(/git worktree add failed/);
    expect(failed.blocked).toMatch(/could not be prepared/);
    const pending = failed.pending ?? [];
    expect(pending.map((p) => [p.text, p.delivery, p.request_id])).toEqual([['TOOL:20 fix the widget', 'recovered', 'thread-start']]);
    // Ben's own message: he can still edit or remove it while it waits.
    expect(isEditable(pending[0])).toBe(true);
  });

  it('reads the answer to Retry: preparing, with the prompt still waiting', () => {
    const retried = fixture<{ thread: ThreadDetail['thread']; pending: PendingMsg[] }>('setup-retried.json');
    expect(retried.thread.setup).toBe('preparing');
    expect(retried.thread.setup_error).toBeNull();
    expect(retried.pending.map((p) => p.request_id)).toEqual(['thread-start']);
  });

  it('shows Setup failed with the reason and Retry, and Preparing without it', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { SetupCard } = await import('../src/components/thread/SetupCard.tsx');
    const html = (thread: ThreadDetail['thread']) => renderToStaticMarkup(createElement(SetupCard, { thread, onRetried: () => {} }));
    const shown = html(failed.thread);
    expect(shown).toContain('Setup failed');
    expect(shown).toContain('git worktree add failed');
    expect(shown).toContain('Retry');
    expect(shown).toContain(failed.thread.branch!);
    const preparing = html({ ...failed.thread, setup: 'preparing', setup_error: null });
    expect(preparing).toContain('Preparing worktree');
    expect(preparing).not.toContain('Retry');
    expect(html({ ...failed.thread, setup: null, setup_error: null })).toBe('');
  });
});
