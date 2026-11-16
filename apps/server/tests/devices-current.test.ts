import { describe, expect, it } from 'vitest';
import type { DeviceRecord } from '@omni/shared/handoff.ts';
import { currentRecords } from '../sync/devices.ts';
import { reachabilityOf, type Tailnet } from '../tailscale.ts';

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

  it('keeps machines on different nodes and machines without a node', () => {
    const a = rec('a', '2026-10-24T07:26:29.445Z', 'n1');
    const b = rec('b', '2026-10-30T10:49:39.011Z', null);
    const c = rec('c', '2026-10-30T10:49:40.011Z', null);
    expect(currentRecords([a, b, c])).toEqual([a, b, c]);
  });

  it('merges a live record without a node into the stale record on its node under the same name', () => {
    // omarchy twice on the dashboard: its old id still names its node, its live id announced while Tailscale did not answer.
    const old = rec('old', '2026-11-10T09:00:00.000Z', 'n1');
    const live = { ...rec('live', '2026-11-16T06:55:00.000Z', null, 'Omarchy'), caps: { 'claude-code': 12 } };
    const merged = { ...live, tailscale: old.tailscale, carriedNode: true };
    expect(currentRecords([old, live], null)).toEqual([merged]);
    expect(currentRecords([live, old], null)).toEqual([merged]);
  });

  it('keeps two same-named machines that both run without Tailscale', () => {
    const old = rec('old', '2026-11-10T09:00:00.000Z', null);
    const live = rec('live', '2026-11-16T06:55:00.000Z', null);
    expect(currentRecords([old, live], null)).toEqual([old, live]);
  });

  it('keeps a live record that has a node over an older one without', () => {
    const old = rec('old', '2026-11-10T09:00:00.000Z', null);
    const live = rec('live', '2026-11-16T06:55:00.000Z', 'n1');
    expect(currentRecords([old, live], null)).toEqual([live]);
  });

  it('leaves a node-less record alone when its name sits on two nodes', () => {
    const x = rec('x', '2026-11-10T09:00:00.000Z', 'n1');
    const y = rec('y', '2026-11-11T09:00:00.000Z', 'n2');
    const z = rec('z', '2026-11-12T09:00:00.000Z', null);
    expect(currentRecords([x, y, z], null)).toEqual([x, y, z]);
  });

  it('leaves the name alone when one node sits beside two records without a node', () => {
    const x = rec('x', '2026-11-10T09:00:00.000Z', 'n1');
    const y = rec('y', '2026-11-11T09:00:00.000Z', null);
    const z = rec('z', '2026-11-12T09:00:00.000Z', null);
    expect(currentRecords([x, y, z], null)).toEqual([x, y, z]);
  });

  it("never drops this machine's own record or hands its node to another", () => {
    const self = rec('self', '2026-11-10T09:00:00.000Z', 'n1');
    const other = rec('other', '2026-11-16T06:55:00.000Z', null);
    expect(currentRecords([self, other], 'self')).toEqual([self, other]);
    const oldSelf = rec('self', '2026-11-10T09:00:00.000Z', null);
    const newer = rec('other', '2026-11-16T06:55:00.000Z', 'n1');
    expect(currentRecords([oldSelf, newer], 'self')).toEqual([oldSelf, newer]);
  });

  it('merges when this machine is the live record without a node', () => {
    const old = rec('old', '2026-11-10T09:00:00.000Z', 'n1');
    const self = rec('self', '2026-11-16T06:55:00.000Z', null);
    expect(currentRecords([old, self], 'self')).toEqual([{ ...self, tailscale: old.tailscale, carriedNode: true }]);
  });

  it('breaks a tie on the same timestamp by id so every machine picks the same one', () => {
    const x = rec('x', '2026-11-01T00:00:00.000Z', 'n1');
    const y = rec('y', '2026-11-01T00:00:00.000Z', 'n1');
    expect(currentRecords([x, y])).toEqual([y]);
    expect(currentRecords([y, x])).toEqual([y]);
  });
});

describe('reachabilityOf a carried node', () => {
  const net = (online: boolean): Tailnet => ({
    self: { nodeId: 'me', dnsName: 'me.ts.net' },
    peers: new Map([['n1', { online, dnsName: 'n1.ts.net', lastSeen: online ? null : '2026-11-01T00:00:00.000Z' }]]),
  });
  const carried = { tailscale: { nodeId: 'n1', dnsName: 'n1.ts.net' }, carriedNode: true as const };

  it('reads an online carried node as online', () => {
    expect(reachabilityOf(net(true), carried).reachability).toBe('online');
  });

  it('reads an offline carried node as unknown, since it may be a dead entry', () => {
    expect(reachabilityOf(net(false), carried)).toEqual({ reachability: 'unknown', dnsName: 'n1.ts.net', lastSeen: null });
    expect(reachabilityOf(net(false), { tailscale: carried.tailscale }).reachability).toBe('offline');
  });
});
