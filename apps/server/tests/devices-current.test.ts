import { describe, expect, it } from 'vitest';
import type { DeviceRecord } from '@omni/shared/handoff.ts';
import { currentRecords } from '../sync/devices.ts';

const rec = (id: string, at: string, nodeId: string | null, name = 'omarchy'): DeviceRecord => ({
  id,
  name,
  tailscale: nodeId ? { nodeId, dnsName: `${nodeId}.ts.net` } : null,
  at,
});

describe('currentRecords', () => {
  it('keeps only the newest record for a Tailscale node', () => {
    const old = rec('old', '2026-10-29T15:12:45.855Z', 'n1');
    const live = rec('new', '2026-11-01T12:54:33.064Z', 'n1');
    expect(currentRecords([old, live])).toEqual([live]);
    expect(currentRecords([live, old])).toEqual([live]);
  });

  it('keeps machines on different nodes and differently named machines without a node', () => {
    const a = rec('a', '2026-10-24T07:26:29.445Z', 'n1');
    const b = rec('b', '2026-10-30T10:49:39.011Z', null, "Ben's MacBook Air");
    const c = rec('c', '2026-10-30T10:49:40.011Z', null, "Ben's MacBook Pro");
    const d = rec('d', '2026-10-30T10:49:41.011Z', 'n2', "Ben's MacBook Pro 2");
    expect(currentRecords([a, b, c, d])).toEqual([a, b, c, d]);
  });

  it('merges a live record without a node into the stale record on its node under the same name', () => {
    // omarchy twice on the dashboard: its old id still names its node, its live id announced while Tailscale did not answer.
    const old = rec('old', '2026-11-10T09:00:00.000Z', 'n1');
    const live = { ...rec('live', '2026-11-16T06:55:00.000Z', null, 'Omarchy'), caps: { 'claude-code': 12 } };
    const merged = { ...live, tailscale: old.tailscale };
    expect(currentRecords([old, live])).toEqual([merged]);
    expect(currentRecords([live, old])).toEqual([merged]);
  });

  it('keeps the newest of same-named records without any node', () => {
    const old = rec('old', '2026-11-10T09:00:00.000Z', null);
    const live = rec('live', '2026-11-16T06:55:00.000Z', null);
    expect(currentRecords([old, live])).toEqual([live]);
  });

  it('keeps a live record that has a node over an older one without', () => {
    const old = rec('old', '2026-11-10T09:00:00.000Z', null);
    const live = rec('live', '2026-11-16T06:55:00.000Z', 'n1');
    expect(currentRecords([old, live])).toEqual([live]);
  });

  it('leaves a node-less record alone when its name sits on two nodes', () => {
    const x = rec('x', '2026-11-10T09:00:00.000Z', 'n1');
    const y = rec('y', '2026-11-11T09:00:00.000Z', 'n2');
    const z = rec('z', '2026-11-12T09:00:00.000Z', null);
    expect(currentRecords([x, y, z])).toEqual([x, y, z]);
  });

  it('breaks a tie on the same timestamp by id so every machine picks the same one', () => {
    const x = rec('x', '2026-11-01T00:00:00.000Z', 'n1');
    const y = rec('y', '2026-11-01T00:00:00.000Z', 'n1');
    expect(currentRecords([x, y])).toEqual([y]);
    expect(currentRecords([y, x])).toEqual([y]);
  });
});
