import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  H.db.channels.create({ id: 'colors', name: 'Colors' });
});
const patch = async (body: unknown) => {
  const res = await app.request('/api/channels/colors', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
};
describe('channel avatar color API', () => {
  it('leaves legacy channels unchanged until the icon changes', async () => {
    expect(H.db.channels.get('colors')).toMatchObject({ avatar_bg: null, avatar_bg_manual: 0 });
    expect((await patch({ name: 'Color samples' })).body.avatar_bg).toBeNull();
    const auto = await patch({ icon: '🌻' });
    expect(auto.body.avatar_bg).toMatch(/^#[\da-f]{6}$/);
    expect((await patch({ notes: 'same color' })).body.avatar_bg).toBe(auto.body.avatar_bg);
  });
  it('keeps a manual color on icon changes, validates hex, and resets to SVG auto', async () => {
    expect((await patch({ avatar_bg: '#123456' })).body.avatar_bg_manual).toBe(1);
    const icon = 'svg:<svg viewBox="0 0 20 20"><rect width="20" height="20" fill="#abcdef"/></svg>';
    expect((await patch({ icon })).body.avatar_bg).toBe('#123456');
    expect((await patch({ avatar_bg_manual: 0 })).body).toMatchObject({ avatar_bg: '#abcdef', avatar_bg_manual: 0 });
    expect((await patch({ avatar_bg: 'url(evil)' })).status).toBe(400);
    expect(H.db.channels.get('colors')!.avatar_bg).toBe('#abcdef');
  });
});
