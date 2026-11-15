import type { AppPushAlertRef } from '@omni/shared/app-pairing.ts';
import { describe, expect, it } from 'vitest';

import { alertsForThread, createAlertClearer, deliveredAlerts, settleQueries, type Delivered } from './clear';
import type { PushServer } from './registration';

const AT = '2026-11-15T10:00:00.000Z';
const note = (identifier: string, omni: unknown) => ({ request: { identifier, content: { data: { omni } } } });
const pr: Delivered = { id: 'n-pr', alert: { kind: 'prAttention', threadId: 't1', channelId: 'c1', at: AT } };
const question: Delivered = { id: 'n-q', alert: { kind: 'needsInput', threadId: 'job', channelId: 'c1', askerId: 'crew', at: AT } };
const old: Delivered = { id: 'n-old', alert: { kind: 'finished', threadId: 't2', channelId: null } };

describe('deliveredAlerts', () => {
  it('keeps Omni\'s alerts, by identifier, and leaves anything else alone', () => {
    expect(deliveredAlerts([note('n-pr', pr.alert), note('other', null)])).toEqual([pr]);
  });
});

describe('alertsForThread', () => {
  it('covers the thread\'s own alerts and a question it asked on its job\'s thread', () => {
    expect(alertsForThread([pr, question, old], 't1')).toEqual(['n-pr']);
    expect(alertsForThread([pr, question, old], 'crew')).toEqual(['n-q']);
    expect(alertsForThread([pr, question, old], 'job')).toEqual(['n-q']);
    expect(alertsForThread([pr, question, old], 'none')).toEqual([]);
  });
});

describe('settleQueries', () => {
  it('asks about alerts that carry the time they were sent, and skips one from an older server', () => {
    expect(settleQueries([pr, old])).toEqual([{ id: 'n-pr', kind: 'prAttention', threadId: 't1', at: AT }]);
  });
});

function harness(opts: { delivered: Delivered[]; answers: Record<string, string[] | Error> }) {
  const servers: PushServer[] = Object.keys(opts.answers).map((id) => ({ id, origin: `https://${id}.example.com` }));
  const asked: { server: string; alerts: AppPushAlertRef[] }[] = [];
  const dismissed: string[] = [];
  const clearer = createAlertClearer({
    delivered: async () => opts.delivered,
    servers: async () => servers,
    settled: async (server, alerts) => {
      asked.push({ server: server.id, alerts });
      const answer = opts.answers[server.id]!;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    dismiss: async (id) => void dismissed.push(id),
  });
  return { clearer, asked, dismissed };
}

describe('createAlertClearer', () => {
  it('clears what any paired server says is settled, once each, and keeps the rest', async () => {
    const h = harness({ delivered: [pr, question], answers: { a: ['n-pr'], b: ['n-pr'], down: new Error('offline') } });
    await h.clearer.sweep();
    expect(h.asked.map((x) => x.server)).toEqual(['a', 'b', 'down']);
    expect(h.dismissed).toEqual(['n-pr']);
  });

  it('asks nothing when no alert can be asked about', async () => {
    const h = harness({ delivered: [old], answers: { a: ['n-old'] } });
    await h.clearer.sweep();
    expect(h.asked).toEqual([]);
    expect(h.dismissed).toEqual([]);
  });

  it('runs one sweep at a time, and once more for calls that came during it', async () => {
    const h = harness({ delivered: [pr], answers: { a: [] } });
    await Promise.all([h.clearer.sweep(), h.clearer.sweep(), h.clearer.sweep()]);
    expect(h.asked).toHaveLength(2);
  });

  it('clears a thread\'s alerts at once when it opens here, without asking', async () => {
    const h = harness({ delivered: [pr, question, old], answers: { a: [] } });
    await h.clearer.opened('t1');
    expect(h.dismissed).toEqual(['n-pr']);
    expect(h.asked).toEqual([]);
  });
});
