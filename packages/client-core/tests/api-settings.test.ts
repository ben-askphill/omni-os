import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('search', () => {
  it('sends the query encoded and returns the hits', async () => {
    const hits = [{ thread_id: 't1', title: 'Fix', snippet: 'a <mark>b</mark>', event_id: 4 }];
    const { sent, api: a } = api({ json: hits });
    expect(await a.search('fix & more')).toEqual(hits);
    expect(sent).toEqual([{ method: 'GET', url: at('/search?q=fix%20%26%20more') }]);
  });
});

describe('devices', () => {
  it('unwraps the device list', async () => {
    const devices = [{ id: 'd1', name: 'iPhone', kind: 'app', createdAt: 'a', lastSeenAt: 'b', current: true }];
    const { sent, api: a } = api({ json: { devices } });
    expect(await a.signedInDevices()).toEqual(devices);
    expect(sent).toEqual([{ method: 'GET', url: at('/auth/devices') }]);
  });

  it('revokes a device by id, escaping the id', async () => {
    const { sent, api: a } = api({ json: { ok: true } });
    await a.revokeDevice('a/b');
    expect(sent).toEqual([{ method: 'DELETE', url: at('/auth/devices/a%2Fb') }]);
  });
});

describe('automations', () => {
  it('reads the list', async () => {
    const rows = [{ id: 'daily', name: 'Daily', cron: '0 9 * * *', enabled: true }];
    const { sent, api: a } = api({ json: rows });
    expect(await a.automations()).toEqual(rows);
    expect(sent).toEqual([{ method: 'GET', url: at('/automations') }]);
  });

  it('pauses and resumes one', async () => {
    const { sent, api: a } = api({ json: { ok: true } });
    await a.setAutomationEnabled('daily', false);
    await a.setAutomationEnabled('daily', true);
    expect(sent).toEqual([
      { method: 'POST', url: at('/automations/daily/enabled'), body: { enabled: false } },
      { method: 'POST', url: at('/automations/daily/enabled'), body: { enabled: true } },
    ]);
  });
});

describe('server config', () => {
  it('reads and saves the setup state with the patch as the body', async () => {
    const { sent, api: a } = api({ json: { onboarded: true } });
    await a.setup();
    await a.updateSetup({ user: { name: 'Ben' }, runOn: { device: '' } });
    await a.serverOptions();
    expect(sent).toEqual([
      { method: 'GET', url: at('/setup') },
      { method: 'PUT', url: at('/setup'), body: { user: { name: 'Ben' }, runOn: { device: '' } } },
      { method: 'GET', url: at('/setup/server') },
    ]);
  });

  it('saves the worktree retention on its own route', async () => {
    const { sent, api: a } = api({ json: { cleanup: { policy: { enabled: true, idleDays: 7 } } } });
    expect((await a.setRetention({ idleDays: 7 })).cleanup.policy.idleDays).toBe(7);
    expect(sent).toEqual([{ method: 'PUT', url: at('/worktrees/retention'), body: { idleDays: 7 } }]);
  });
});

describe('secrets', () => {
  it('sets and deletes by scope and name, with the delete carrying a body', async () => {
    const { sent, api: a } = api({ json: { ok: true } });
    await a.secrets();
    await a.setSecret('channel:acme', 'API_KEY', 'v');
    await a.deleteSecret('global', 'API_KEY');
    expect(sent).toEqual([
      { method: 'GET', url: at('/secrets') },
      { method: 'POST', url: at('/secrets'), body: { scope: 'channel:acme', name: 'API_KEY', value: 'v' } },
      { method: 'DELETE', url: at('/secrets'), body: { scope: 'global', name: 'API_KEY' } },
    ]);
  });
});

describe('channel settings', () => {
  it('creates with the id in the body and patches by escaped id', async () => {
    const { sent, api: a } = api({ json: { id: 'acme' } });
    await a.createChannel('acme', { name: 'Acme' });
    await a.updateChannel('a/b', { archived: 1 });
    await a.setDesignSystem('acme', 'ds.html', '<html></html>');
    await a.removeDesignSystem('acme');
    expect(sent).toEqual([
      { method: 'POST', url: at('/channels'), body: { id: 'acme', name: 'Acme' } },
      { method: 'PATCH', url: at('/channels/a%2Fb'), body: { archived: 1 } },
      { method: 'PUT', url: at('/channels/acme/design-system'), body: { name: 'ds.html', html: '<html></html>' } },
      { method: 'DELETE', url: at('/channels/acme/design-system') },
    ]);
  });

  it('lists, adds, replaces and deletes channel actions', async () => {
    const { sent, api: a } = api({ json: {} });
    const input = { name: 'Tests', command: 'npm test', secrets: [], port: null, setup: null };
    await a.channelActions('acme');
    await a.addChannelAction('acme', input);
    await a.updateChannelAction('acme', 'act1', input);
    await a.deleteChannelAction('acme', 'act1');
    expect(sent).toEqual([
      { method: 'GET', url: at('/channels/acme/actions') },
      { method: 'POST', url: at('/channels/acme/actions'), body: input },
      { method: 'PATCH', url: at('/channels/acme/actions/act1'), body: input },
      { method: 'DELETE', url: at('/channels/acme/actions/act1') },
    ]);
  });
});
