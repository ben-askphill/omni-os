import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A channel's design system: a standalone HTML file set in the channel's settings. The API keeps the file out of
// channel JSON, and a thread's system prompt points at a copy in its own folder.

const r = await startRunner();
const { app } = await import('../server/app.ts');
const { designSystemFile } = await import('../server/config.ts');
const { writeDesignSystem } = await import('../server/sandbox.ts');
const { buildSystemPrompt } = await import('../server/runner/prompts.ts');

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

const HTML = '<!doctype html><html><head><style>:root{--brand:#e4572e}</style></head><body><h1>Brand</h1></body></html>';

describe('channel design system', () => {
  it('stores the file and shows only its name and size in channel JSON', async () => {
    await send('POST', '/api/channels', { id: 'branded', name: 'Branded' });
    const put = await json(await send('PUT', '/api/channels/branded/design-system', { name: 'brand.html', html: `﻿  ${HTML}\n` }));
    expect(put).toMatchObject({ design_system_name: 'brand.html', design_system_size: HTML.length });
    expect(put).not.toHaveProperty('design_system');

    const got = await json(await send('GET', '/api/channels/branded'));
    expect(got.design_system_name).toBe('brand.html');
    expect(got).not.toHaveProperty('design_system');
    const listed = (await json(await send('GET', '/api/channels'))).find((c: any) => c.id === 'branded');
    expect(listed).not.toHaveProperty('design_system');
    // An edit of another field keeps it.
    expect((await json(await send('PATCH', '/api/channels/branded', { notes: 'x' }))).design_system_name).toBe('brand.html');
  });

  it('serves the file sandboxed', async () => {
    const res = await send('GET', '/api/channels/branded/design-system');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(await res.text()).toBe(HTML);
  });

  it('refuses a file that is empty, too big or not HTML', async () => {
    for (const html of ['  ', 'just words', 'x'.repeat(600 * 1024)]) {
      expect((await send('PUT', '/api/channels/branded/design-system', { name: 'bad.html', html })).status).toBe(400);
    }
    expect((await send('PUT', '/api/channels/nope/design-system', { name: 'a.html', html: HTML })).status).toBe(404);
    expect((await json(await send('GET', '/api/channels/branded'))).design_system_name).toBe('brand.html');
  });

  it('points the system prompt at a copy in the thread folder, and drops it when removed', async () => {
    await send('PUT', '/api/channels/scratch/design-system', { name: 'brand.html', html: HTML });
    const ch = () => r.db.channels.get('scratch')!;
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    // The runner wrote it when the thread's process started.
    expect(readFileSync(designSystemFile(t.id), 'utf8')).toBe(HTML);
    const prompt = buildSystemPrompt(r.thread(t.id), ch());
    expect(prompt).toContain('## Design system');
    expect(prompt).toContain(designSystemFile(t.id));
    expect(prompt).toContain('brand.html');
    expect(buildSystemPrompt({ ...r.thread(t.id), harness: 'hermes' }, ch())).not.toContain('## Design system');

    await send('DELETE', '/api/channels/scratch/design-system');
    expect((await json(await send('GET', '/api/channels/scratch'))).design_system_name).toBeNull();
    writeDesignSystem(t.id, ch());
    expect(existsSync(designSystemFile(t.id))).toBe(false);
    expect(buildSystemPrompt(r.thread(t.id), ch())).not.toContain('## Design system');
  });
});
