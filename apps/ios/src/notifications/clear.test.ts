import type { AppPushAlertRef } from '@omni/shared/app-pairing.ts';
import { describe, expect, it } from 'vitest';

import { alertsForThread, createAlertClearer, deliveredAlerts, settleQueries, type Delivered } from './clear';
import type { PushServer } from './registration';

const AT = '2026-11-15T10:00:00.000Z';
const note = (identifier: string, omni: unknown) => ({ request: { identifier, content: { data: { omni } } } });
const pr: Delivered = { id: 'n-pr', alert: { kind: 'prAttention', threadId: 't1', channelId: 'c1', at: AT, sender: 'mac-a' } };
const question: Delivered = { id: 'n-q', alert: { kind: 'needsInput', threadId: 'job', channelId: 'c1', askerId: 'crew', at: AT, sender: 'mac-a' } };
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
  it('asks about alerts that carry when and by whom they were sent, and skips one from an older server', () => {
    const noSender: Delivered = { id: 'n-x', alert: { kind: 'failed', threadId: 't3', channelId: null, at: AT } };
    expect(settleQueries([pr, old, noSender])).toEqual([{ id: 'n-pr', kind: 'prAttention', threadId: 't1', at: AT, sender: 'mac-a' }]);
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

  it('asks in batches the server accepts, so a full Notification Center still clears', async () => {
    const many: Delivered[] = Array.from({ length: 250 }, (_, i) => ({ ...pr, id: `n${i}` }));
    const h = harness({ delivered: many, answers: { a: ['n0', 'n150', 'n249'] } });
    await h.clearer.sweep();
    expect(h.asked.map((x) => x.alerts.length)).toEqual([100, 100, 50]);
    expect(h.dismissed).toEqual(['n0', 'n150', 'n249']);
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
