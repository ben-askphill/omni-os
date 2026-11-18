import { describe, expect, it } from 'vitest';
import { isWorking } from '@omni/shared/delegate-count.ts';
import type { MachineLoad } from '@omni/shared/machines.ts';
import { inboxLayout, type InboxThread } from '../src/inbox.ts';
import { runningListFilter } from '../src/running-list.ts';

const at = '2026-11-18T08:00:00.000Z';
const thread = (id: string, over: Partial<InboxThread> = {}): InboxThread => ({ id, channel_id: 'omni-os', title: id, status: 'done', created_at: at, updated_at: at, ...over }) as InboxThread;

// The bug from the dashboard: Ben's MacBook Pro tile said "1 running · 1 delegated", and its Working list was empty.
const job = thread('job', { channel_id: 'conductor', delegating: true });
const crew = thread('crew', { status: 'running', parent_id: 'job' });
const mac = { threadIds: ['crew'], running: 1, queued: 0, delegated: 1 } as Pick<MachineLoad, 'threadIds' | 'running' | 'queued' | 'delegated'>;

function working() {
  const layout = inboxLayout({ threads: [job, crew], needs: [], delegated: new Set(['crew']), open: null });
  return new Set(layout.working.map((t) => t.id));
}

describe('the Working list on one machine', () => {
  it('lists a delegated thread running there, as its tile counts it', () => {
    const list = [job, crew].filter(runningListFilter(working(), mac));
    expect(list.map((t) => t.id)).toEqual(['crew']);
    expect(list.length).toBe(mac.running + mac.queued);
  });

  it('lists a queued delegated thread there too', () => {
    const queued = thread('crew', { status: 'queued', parent_id: 'job' });
    expect([queued].filter(runningListFilter(working(), mac)).map((t) => t.id)).toEqual(['crew']);
  });

  it('leaves out a thread that stopped since the machine was read', () => {
    const stopped = thread('crew', { status: 'stopped', parent_id: 'job' });
    expect(isWorking(stopped)).toBe(false);
    expect([stopped].filter(runningListFilter(working(), mac))).toEqual([]);
  });

  it('shows nothing until the machine is known', () => {
    expect([job, crew].filter(runningListFilter(working(), undefined, true))).toEqual([]);
  });
});

describe('the Working list across machines', () => {
  it('stays the Inbox Working shelf: the job stands for its delegated threads', () => {
    expect([job, crew].filter(runningListFilter(working(), undefined)).map((t) => t.id)).toEqual(['job']);
  });
});
