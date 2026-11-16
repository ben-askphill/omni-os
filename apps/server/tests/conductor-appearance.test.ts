import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The Conductor's channel is seeded on every start. Its look is Ben's to change like any other channel's: the seed
// starts it with none (the clients draw the Omni mark) and never puts it back.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
let seedSystemChannels: typeof import('../db/repos/channels.ts')['seedSystemChannels'];
beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  ({ seedSystemChannels } = await import('../db/repos/channels.ts'));
});
const request = async (method: string, body?: unknown) => {
  const res = await app.request('/api/channels/conductor', { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as any };
};

describe("the Conductor's appearance", () => {
  it('starts with no icon or background, so the clients draw their default mark', async () => {
    const { status, body } = await request('GET');
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: 'conductor', kind: 'system', icon: null, avatar_bg: null, avatar_bg_manual: 0 });
  });

  it('takes an icon and a background through the same PATCH as any channel', async () => {
    const icon = await request('PATCH', { icon: 'icon:target' });
    expect(icon.status).toBe(200);
    expect(icon.body.icon).toBe('icon:target');
    expect(icon.body.avatar_bg).toMatch(/^#[\da-f]{6}$/);
    const color = await request('PATCH', { avatar_bg: '#283c62' });
    expect(color.body).toMatchObject({ icon: 'icon:target', avatar_bg: '#283c62', avatar_bg_manual: 1 });
  });

  it('keeps what was saved when the system channels are seeded again on the next start', async () => {
    seedSystemChannels();
    expect(H.db.channels.get('conductor')).toMatchObject({ name: 'Conductor', kind: 'system', icon: 'icon:target', avatar_bg: '#283c62', avatar_bg_manual: 1 });
    expect((await request('GET')).body).toMatchObject({ icon: 'icon:target', avatar_bg: '#283c62' });
  });

  it('goes back to the default when the icon and background are cleared', async () => {
    const cleared = await request('PATCH', { icon: '', avatar_bg: null, avatar_bg_manual: 0 });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ icon: null, avatar_bg: null, avatar_bg_manual: 0 });
  });
});
