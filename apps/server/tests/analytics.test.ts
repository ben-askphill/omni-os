import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Usage analytics (apps/server/analytics.ts): nothing reaches PostHog without a project key or with the switch off, and
// what does go carries only the events and properties packages/shared/analytics.ts lists. A local server stands in for
// PostHog's EU host and records every request.

const received: { url: string; body: { api_key: string; batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[] } }[] = [];
const fake = createServer((req: IncomingMessage, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    received.push({ url: req.url ?? '', body: JSON.parse(data) });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"Ok"}');
  });
});
await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
process.env.OMNI_POSTHOG_HOST = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
// No timer flush mid-test: each test flushes when it means to.
process.env.OMNI_POSTHOG_FLUSH_MS = '600000';
afterAll(() => fake.close());

const r = await startRunner({ OMNI_SECRET_STORE: 'file' });
const { app } = await import('../app.ts');
const { capture, flushAnalytics, resetAnalyticsForTests } = await import('../analytics.ts');
const { setSecret, deleteSecret } = await import('../secrets.ts');
const raw = (await import('../db.ts')).db;

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = async () => (await app.request('/api/analytics')).json();
const setOn = (enabled: boolean) => app.request('/api/analytics', json('PUT', { enabled }));
const clientEvent = (event: string, props: unknown) => app.request('/api/analytics/events', json('POST', { event, props }));
const events = () => received.flatMap((r) => r.body.batch);

/** Everything a test does that would send an event: a new thread, a message, a screen, an error, a setting. */
async function doThings() {
  const t = await r.start('Fix the Acme checkout on acme.myshopify.com');
  await r.untilResults(t.id, 1);
  await app.request(`/api/threads/${t.id}/messages`, json('POST', { prompt: 'Also check the Acme cart drawer' }));
  await clientEvent('screen_viewed', { surface: 'web', screen: 'thread', section: 'changes', title: 'Acme checkout', path: '/Users/ben/code/acme' });
  await app.request('/api/analytics/exception', json('POST', { type: 'TypeError', message: 'cannot read acme-theme', frames: [{ function: 'render', file: 'index-abc.js', line: 3, col: 9 }] }));
  await app.request('/api/display', json('PUT', { technical: true }));
  capture('server_started', { bundled: false, sync: false });
}

beforeEach(async () => {
  resetAnalyticsForTests();
  received.length = 0;
  process.env.OMNI_POSTHOG_KEY = '';
  await deleteSecret('global', 'POSTHOG_KEY').catch(() => undefined);
  raw.prepare("DELETE FROM kv WHERE key = 'analytics'").run();
});

describe('usage analytics', () => {
  it('sends nothing without a project key, with the switch on', async () => {
    expect(await state()).toEqual({ enabled: true, configured: false });
    await doThings();
    expect(await flushAnalytics()).toEqual({ sent: 0 });
    expect(received).toEqual([]);
  });

  it('sends nothing with a key while the switch is off, and turning it off drops what was waiting', async () => {
    process.env.OMNI_POSTHOG_KEY = 'phc_test_key';
    capture('server_started', { bundled: false, sync: false });
    expect(await (await setOn(false)).json()).toEqual({ enabled: false, configured: true });
    await doThings();
    expect(await flushAnalytics()).toEqual({ sent: 0 });
    expect(received).toEqual([]);
  });

  it('sends the listed events with only their listed properties once there is a key', async () => {
    process.env.OMNI_POSTHOG_KEY = 'phc_test_key';
    await doThings();
    const { sent, status } = await flushAnalytics();
    expect(status).toBe(200);
    expect(sent).toBeGreaterThan(0);
    expect(received.map((r) => r.url)).toEqual(['/batch/']);
    expect(received[0].body.api_key).toBe('phc_test_key');
    const names = events().map((e) => e.event);
    expect(names).toEqual(expect.arrayContaining(['thread_created', 'message_sent', 'screen_viewed', '$exception', 'settings_changed', 'server_started']));
    // One anonymous id, no person profile, no GeoIP.
    expect(new Set(events().map((e) => e.distinct_id)).size).toBe(1);
    for (const e of events()) expect(e.properties).toMatchObject({ $process_person_profile: false, $geoip_disable: true, $lib: 'omni-server' });
    const screen = events().find((e) => e.event === 'screen_viewed')!.properties;
    expect(screen).toMatchObject({ surface: 'web', screen: 'thread', section: 'changes' });
    expect(screen).not.toHaveProperty('title');
    expect(screen).not.toHaveProperty('path');
    expect(events().find((e) => e.event === 'thread_created')!.properties).toMatchObject({ harness: 'claude-code', source: 'manual', delegated: false });
    expect(events().find((e) => e.event === 'settings_changed')!.properties).toMatchObject({ setting: 'display.technical', value: true });
    // The prompt, the store, the error's message and the path never leave.
    const wire = JSON.stringify(received);
    for (const leak of ['Acme', 'acme', 'myshopify', 'checkout', '/Users/']) expect(wire).not.toContain(leak);
    const ex = events().find((e) => e.event === '$exception')!.properties.$exception_list as { type: string; value: string; stacktrace: { frames: { filename: string }[] } }[];
    expect(ex[0]).toMatchObject({ type: 'TypeError', value: 'TypeError', stacktrace: { frames: [{ filename: 'index-abc.js' }] } });
  });

  it('reads the key from the global secret POSTHOG_KEY', async () => {
    await setSecret('global', 'POSTHOG_KEY', 'phc_from_secret');
    expect(await state()).toEqual({ enabled: true, configured: true });
    capture('server_started', { bundled: true, sync: false });
    await flushAnalytics();
    expect(received.map((r) => r.body.api_key)).toEqual(['phc_from_secret']);
  });

  it('marks a team, which is one thread, as a team', async () => {
    process.env.OMNI_POSTHOG_KEY = 'phc_test_key';
    for (const [id, name] of [['team-lead', 'Team Lead'], ['team-designer', 'Team Designer']]) {
      expect((await app.request('/api/crew', json('POST', { id, fields: { name, harness: 'claude-code' }, charter: `You are ${name}.` }))).status).toBe(201);
    }
    const { thread } = await r.runner.createTeam({ channel: 'scratch', prompt: 'Plan the launch page', role: 'team-lead', tasks: [{ title: 'Visuals', prompt: 'make the visuals', role: 'team-designer' }] });
    await r.untilResults(thread.id, 1);
    await flushAnalytics();
    expect(events().filter((e) => e.event === 'thread_created').map((e) => e.properties)).toEqual([expect.objectContaining({ source: 'conductor', team: true })]);
  });

  it('takes from a client only the events a client reports', async () => {
    process.env.OMNI_POSTHOG_KEY = 'phc_test_key';
    expect((await clientEvent('thread_created', { harness: 'codex' })).status).toBe(400);
    expect((await clientEvent('made_up', {})).status).toBe(400);
    expect((await clientEvent('settings_changed', { setting: 'display.technical', value: true })).status).toBe(400);
    expect((await clientEvent('settings_changed', { setting: 'theme' })).status).toBe(204);
    await flushAnalytics();
    expect(events().map((e) => e.event)).toEqual(['settings_changed']);
  });
});
