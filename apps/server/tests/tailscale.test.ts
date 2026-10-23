import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureTailscale, parseStatus, reachabilityOf, tailnet } from '../tailscale.ts';
import { FAKE_TAILSCALE, tailscaleStatus } from './support.ts';

const tmp = mkdtempSync(join(tmpdir(), 'omni-tailscale-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const LAST_SEEN = '2026-10-23T08:15:00Z';
// Two Macs named the same on one tailnet, as on Ben's: only the node ID tells them apart.
const STATUS = tailscaleStatus({ id: 'nSelf', dns: 'office-air.tail1234.ts.net' }, [
  { id: 'nHome', dns: 'home-pro.tail1234.ts.net', online: true },
  { id: 'nOld', dns: 'old-air.tail1234.ts.net', online: false, lastSeen: LAST_SEEN },
]);
const device = (nodeId: string | null) => ({ tailscale: nodeId ? { nodeId, dnsName: `${nodeId}.tail1234.ts.net` } : null });

describe('reachability from tailscale status', () => {
  const net = parseStatus(STATUS);

  it('reads this Mac\'s own node, without the trailing dot', () => {
    expect(net?.self).toEqual({ nodeId: 'nSelf', dnsName: 'office-air.tail1234.ts.net' });
  });

  it('tells two Macs with the same HostName apart by node ID', () => {
    expect(reachabilityOf(net, device('nHome'))).toEqual({ reachability: 'online', dnsName: 'home-pro.tail1234.ts.net', lastSeen: null });
    expect(reachabilityOf(net, device('nOld'))).toEqual({
      reachability: 'offline',
      dnsName: 'old-air.tail1234.ts.net',
      lastSeen: new Date(LAST_SEEN).toISOString(),
    });
  });

  it('says unknown when either Mac has no Tailscale, or the node is not one of this tailnet\'s', () => {
    expect(reachabilityOf(net, device(null)).reachability).toBe('unknown');
    expect(reachabilityOf(null, device('nHome')).reachability).toBe('unknown');
    expect(reachabilityOf(net, device('nElsewhere'))).toEqual({ reachability: 'unknown', dnsName: 'nElsewhere.tail1234.ts.net', lastSeen: null });
  });

  it('reads nothing from a Tailscale that is not running, or from output that is not its status', () => {
    expect(parseStatus(JSON.stringify({ ...JSON.parse(STATUS), BackendState: 'Stopped' }))).toBeNull();
    expect(parseStatus('not json')).toBeNull();
    expect(parseStatus(JSON.stringify({ BackendState: 'Running' }))).toBeNull();
  });
});

describe('asking the tailscale CLI', () => {
  const ask = (env: Record<string, string>) => {
    configureTailscale({ env: { ...process.env, ...env } });
    return tailnet();
  };

  it('runs the CLI OMNI_TAILSCALE_BIN names', async () => {
    const file = join(tmp, 'status.json');
    writeFileSync(file, STATUS);
    const net = await ask({ OMNI_TAILSCALE_BIN: FAKE_TAILSCALE, FAKE_TAILSCALE_STATUS: file });
    expect(net?.peers.get('nHome')?.online).toBe(true);
  });

  it('answers null, never throws, when tailscaled is not running or the CLI is missing', async () => {
    expect(await ask({ OMNI_TAILSCALE_BIN: FAKE_TAILSCALE, FAKE_TAILSCALE_STATUS: join(tmp, 'none.json') })).toBeNull();
    expect(await ask({ OMNI_TAILSCALE_BIN: join(tmp, 'no-tailscale') })).toBeNull();
  });
});
