// Rotating the install token (PRD #667, story 10): a new data/api-token, the old token refused, every device session
// ended. On a server whose token comes from the file, not OMNI_TOKEN, so it can rotate.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'omni-rotate-'));
process.env.OMNI_DATA_DIR = dir;
delete process.env.OMNI_TOKEN;
const { app } = await import('../app.ts');
const { apiToken, sessionCookieName, tokenPath } = await import('../api-token.ts');

const call = (path: string, headers: Record<string, string>, method = 'GET') => app.request(`http://127.0.0.1:4747/api${path}`, { method, headers: { host: '127.0.0.1:4747', ...headers } });

describe('POST /api/auth/rotate-token', () => {
  it('writes a new token, refuses the old one and ends every session', async () => {
    const old = apiToken();
    const paired = (await call('/auth/pair', { authorization: `Bearer ${old}` }, 'POST')).headers.get('set-cookie') ?? '';
    const session = paired.match(new RegExp(`${sessionCookieName()}=(omni_s_[0-9a-f]+)`))![1];
    const cookie = { authorization: '', cookie: `${sessionCookieName()}=${session}` };
    expect((await call('/auth', cookie)).status).toBe(200);

    const res = await call('/auth/rotate-token', { authorization: `Bearer ${old}` }, 'POST');
    expect(res.status).toBe(200);
    const fresh = readFileSync(tokenPath(), 'utf8').trim();
    expect(fresh).not.toBe(old);
    expect(fresh).toHaveLength(64);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect((await call('/auth', { authorization: `Bearer ${old}` })).status).toBe(401);
    expect((await call('/auth', { authorization: `Bearer ${fresh}` })).status).toBe(200);
    // The browser paired before it has to pair again.
    expect((await call('/auth', cookie)).status).toBe(401);
  });
});
