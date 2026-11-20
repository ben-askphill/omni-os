import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { png } from './png.ts';
import { startRunner } from './runner-boot.ts';

// Group threads slice 1 (#899, ADR 0019): every agent has a name and an avatar, and every transcript row says which
// agent wrote it. Through the API, on a booted runner with the fake CLI.

const r = await startRunner();
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe('message authors', () => {
  it("records the agent that wrote each new row, and none on Ben's", async () => {
    const t = await r.start('Say hi.', { role: 'builder' });
    await r.untilResults(t.id, 1);
    const { body } = await call('GET', `/threads/${t.id}`);
    const rows = body.events as { kind: string; agent?: string | null }[];
    expect(rows.find((e) => e.kind === 'user')?.agent).toBeNull();
    const replies = rows.filter((e) => e.kind === 'assistant_text' || e.kind === 'result');
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((e) => e.agent === 'builder')).toBe(true);
    // A long thread loads by pages: they carry the author too.
    const page = (await call('GET', `/threads/${t.id}?history=recent`)).body.events as { kind: string; agent?: string | null }[];
    expect(page.filter((e) => e.kind === 'assistant_text').every((e) => e.agent === 'builder')).toBe(true);
    expect(page.find((e) => e.kind === 'user')?.agent).toBeNull();
  });
});

describe('agent avatars', () => {
  it('stores an uploaded image with the crew file and returns it on the agent', async () => {
    const img = png(256, 256);
    const put = await call('PUT', '/crew/builder/avatar', { image: img.url });
    expect(put.status).toBe(200);
    const listed = (await call('GET', '/crew')).body.find((a: any) => a.id === 'builder');
    expect(listed.avatar.image).toMatch(/^\/api\/crew\/builder\/avatar\?v=[0-9a-f]+$/);
    expect(readFileSync(join(paths.personalCrew, 'builder.md'), 'utf8')).toContain(img.url);
    const res = await app.request(listed.avatar.image);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(img.bytes)).toBe(true);
  });

  it('refuses what is not a square PNG, JPEG or WebP of at most 256px', async () => {
    const gif = `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`;
    for (const [image, why] of [
      [gif, /PNG, JPEG or WebP/],
      [png(300, 300).url, /at most 256px/],
      [png(256, 200).url, /square/],
      [png(64, 64).url.replace('image/png', 'image/webp'), /is a PNG, not the WEBP/],
    ] as const) {
      const res = await call('PUT', '/crew/reviewer/avatar', { image });
      expect(res.status, String(why)).toBe(400);
      expect(res.body.error).toMatch(why);
    }
    expect((await call('GET', '/crew/reviewer')).body.role.avatar?.image).toBeUndefined();
  });

  it('keeps the image when the form changes the icon, and drops only the image on remove', async () => {
    const img = png(128, 128);
    await call('PUT', '/crew/reviewer/avatar', { image: img.url });
    await call('PUT', '/crew/reviewer', { fields: { avatar: { icon: 'icon:zap', bg: '#F5E6BA' } } });
    expect((await call('GET', '/crew/reviewer')).body.role.avatar).toMatchObject({ icon: 'icon:zap', bg: '#f5e6ba', image: expect.stringMatching(/^\/api\/crew\/reviewer\/avatar/) });
    await call('PUT', '/crew/reviewer', { fields: { avatar: null } });
    expect((await call('GET', '/crew/reviewer')).body.role.avatar).toEqual({ image: expect.any(String) });
    await call('PUT', '/crew/reviewer/avatar', { image: null });
    expect((await call('GET', '/crew/reviewer')).body.role.avatar).toBeUndefined();
    expect((await app.request('/api/crew/reviewer/avatar')).status).toBe(404);
  });
});

describe('agent names', () => {
  it('refuses a second agent with a name another has, ignoring case', async () => {
    const made = await call('POST', '/crew', { id: 'builder-two', fields: { name: 'builder' }, charter: 'Build.' });
    expect(made.status).toBe(409);
    expect(made.body.error).toMatch(/already called "Builder"/);
    const renamed = await call('PUT', '/crew/reviewer', { fields: { name: 'BUILDER ' } });
    expect(renamed.status).toBe(409);
    expect((await call('POST', '/crew/reviewer/duplicate', { id: 'reviewer-copy', name: 'Builder' })).status).toBe(409);
    expect((await call('PUT', '/crew/builder', { fields: { name: 'Builder', description: 'Ships code.' } })).status).toBe(200);
    expect((await call('POST', '/crew', { id: 'designer', fields: { name: 'Designer' }, charter: 'Design.' })).status).toBe(201);
  });
});
