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
