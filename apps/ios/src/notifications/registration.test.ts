import type { AppPushTokenRequest } from '@omni/shared/app-pairing.ts';
import { describe, expect, it } from 'vitest';

import { createPushRegistrar, type PushServer } from './registration';

const a: PushServer = { id: 'a', origin: 'https://a.example.com' };
const b: PushServer = { id: 'b', origin: 'https://b.example.com' };

function setup(overrides: Partial<Parameters<typeof createPushRegistrar>[0]> = {}) {
  const sent: { server: string; body: AppPushTokenRequest }[] = [];
  const reports: string[] = [];
  const registrar = createPushRegistrar({
    permitted: async () => true,
    deviceToken: async () => 'abc123',
    environment: 'sandbox',
    bundleId: 'app.omni-os.ios',
    servers: async () => [a, b],
    register: async (server, body) => {
      sent.push({ server: server.id, body });
    },
    onReport: (report) => reports.push(report.kind),
    ...overrides,
  });
  return { registrar, sent, reports };
}

describe('createPushRegistrar', () => {
  it('puts the native token, platform, environment and bundle id on every paired server', async () => {
    const { registrar, sent } = setup();

    const report = await registrar.sync();

    expect(report).toEqual({ kind: 'synced', byServer: { a: 'registered', b: 'registered' } });
    expect(sent).toEqual([
      { server: 'a', body: { token: 'abc123', platform: 'ios', environment: 'sandbox', bundleId: 'app.omni-os.ios' } },
      { server: 'b', body: { token: 'abc123', platform: 'ios', environment: 'sandbox', bundleId: 'app.omni-os.ios' } },
    ]);
  });

  it('sends nothing and never asks for a token while notifications are not allowed', async () => {
    let asked = false;
    const { registrar, sent } = setup({
      permitted: async () => false,
      deviceToken: async () => {
        asked = true;
        return 'x';
      },
    });

    expect(await registrar.sync()).toEqual({ kind: 'no-permission' });
    expect(asked).toBe(false);
    expect(sent).toEqual([]);
  });

  it('reports no token when APNs gives none', async () => {
    const { registrar, sent } = setup({
      deviceToken: async () => {
        throw new Error('no aps-environment entitlement');
      },
    });

    expect(await registrar.sync()).toEqual({ kind: 'no-token' });
    expect(sent).toEqual([]);
  });

  it('keeps going when one server fails and says which', async () => {
    const { registrar, sent } = setup({
      register: async (server, body) => {
        if (server.id === 'a') throw new Error('unreachable');
        sent.push({ server: server.id, body });
      },
    });

    const report = await registrar.sync();

    expect(report).toEqual({ kind: 'synced', byServer: { a: 'failed', b: 'registered' } });
  });

  it('registers on no server when none are paired', async () => {
    const { registrar } = setup({ servers: async () => [] });
    expect(await registrar.sync()).toEqual({ kind: 'synced', byServer: {} });
  });

  it('prefers a token APNs just announced to the one it would read', async () => {
    const { registrar, sent } = setup({ servers: async () => [a] });

    await registrar.sync('fresh');

    expect(sent[0]?.body.token).toBe('fresh');
  });

  it('keeps using the announced token on later syncs', async () => {
    const { registrar, sent } = setup({ servers: async () => [a] });

    await registrar.sync('fresh');
    await registrar.sync();

    expect(sent.map((call) => call.body.token)).toEqual(['fresh', 'fresh']);
  });

  it('folds syncs that overlap into the running one plus one more pass', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let passes = 0;
    const { registrar } = setup({
      servers: async () => [a],
      permitted: async () => {
        passes += 1;
        if (passes === 1) await gate;
        return true;
      },
    });

    const first = registrar.sync();
    const second = registrar.sync();
    const third = registrar.sync();
    release();
    await Promise.all([first, second, third]);

    expect(passes).toBe(2);
  });

  it('reports every pass', async () => {
    const { registrar, reports } = setup();
    await registrar.sync();
    await registrar.sync();
    expect(reports).toEqual(['synced', 'synced']);
  });
});
