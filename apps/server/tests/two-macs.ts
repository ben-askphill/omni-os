import { vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryTransport } from '../sync/transport.ts';
import { startRunner } from './runner-boot.ts';
import { FAKE_TAILSCALE } from './support.ts';

// One synced Mac of several in one process: the real server (runner, API, sync worker, file hooks) on its own data and
// home dirs, with fake claude and a fake tailscale CLI whose status the test sets. Every Mac given the same relay sees
// the others' pushes. Boot them one after another: each boot loads fresh copies of the server modules.

export async function bootMac(id: string, name: string, relay: MemoryTransport, env: Record<string, string> = {}) {
  vi.resetModules();
  const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0', ...env });
  const sync = await import('../sync/worker.ts');
  const files = await import('../sync/files.ts');
  const devices = await import('../sync/devices.ts');
  const tailscale = await import('../tailscale.ts');
  const { app } = await import('../app.ts');
  const home = join(r.tmp, 'home');
  mkdirSync(home);
  files.configureFileSync({ home, env: {}, turnDelayMs: 20, openEveryMs: 0 });
  devices.configureDevices({ name });
  const statusFile = join(r.tmp, 'tailscale-status.json');
  /** What `tailscale status --json` prints on this Mac from now on. */
  const tailnet = (json: string) => {
    writeFileSync(statusFile, json);
    tailscale.configureTailscale({ env: { ...process.env, OMNI_TAILSCALE_BIN: FAKE_TAILSCALE, FAKE_TAILSCALE_STATUS: statusFile } });
  };
  tailnet('');
  const worker = sync.createSyncWorker({ transport: relay, machineId: id });
  await sync.setActiveWorker(worker);
  const json = async (path: string, init?: { method?: string; body?: unknown }) => {
    const res = await app.request(`/api${path}`, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  /** Sync, and fail the test on a sync error. */
  const sync1 = async () => {
    const res = await worker.syncNow();
    if (res.error) throw new Error(`${id} sync failed: ${res.error}`);
    return res;
  };
  return { ...r, id, name, home, worker, files, devices, app, json, tailnet, sync: sync1 };
}

export type Mac = Awaited<ReturnType<typeof bootMac>>;
