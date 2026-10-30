import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The Linux secret store end to end: OMNI_SECRET_STORE=file, the secrets routes and what a thread gets, against a
// real db. Values land in secrets.json in the data dir, mode 0600, and never reach `security`, whose stub logs every call.

const r = await startRunner({ OMNI_SECRET_STORE: 'file' });
const securityLog = join(r.tmp, 'security.log');
writeFileSync(join(r.tmp, 'bin', 'security'), `#!/bin/sh\necho "$*" >> '${securityLog}'\nexit 44\n`, { mode: 0o755 });

const { app } = await import('../app.ts');
const { secretStore } = await import('../secret-store.ts');
const { secretsEnv } = await import('../secrets.ts');
const file = join(r.paths.data, 'secrets.json');

const call = async (method: string, body?: unknown) => {
  const res = await app.request('/api/secrets', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const onDisk = () => JSON.parse(readFileSync(file, 'utf8'));

describe('secrets in the file store', () => {
  it('is the store this server uses, as GET /api/status says', async () => {
    expect(secretStore().kind).toBe('file');
    const res = await app.request('/api/status');
    expect(((await res.json()) as any).server.secretStore).toBe('file');
  });

  it('saves a value to secrets.json, mode 0600, and lists only its name', async () => {
    expect(existsSync(file)).toBe(false);
    expect((await call('POST', { scope: 'global', name: 'GITHUB_TOKEN', value: 'ghp_global' })).status).toBe(200);
    expect((await call('POST', { scope: 'channel:scratch', name: 'GITHUB_TOKEN', value: 'ghp_scratch' })).status).toBe(200);

    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(onDisk()).toEqual({ 'global/GITHUB_TOKEN': 'ghp_global', 'channel:scratch/GITHUB_TOKEN': 'ghp_scratch' });
    const listed = (await call('GET')).body as { scope: string; name: string }[];
    expect(listed.map(({ scope, name }) => ({ scope, name }))).toEqual([
      { scope: 'channel:scratch', name: 'GITHUB_TOKEN' },
      { scope: 'global', name: 'GITHUB_TOKEN' },
    ]);
    expect(JSON.stringify(listed)).not.toContain('ghp_');
  });

  it('hands a thread the channel value over the global one', async () => {
    expect(await secretsEnv('scratch')).toMatchObject({ GITHUB_TOKEN: 'ghp_scratch' });
    expect(await secretsEnv('elsewhere')).toMatchObject({ GITHUB_TOKEN: 'ghp_global' });
  });

  it('removes a value from the file and the names table', async () => {
    expect((await call('DELETE', { scope: 'channel:scratch', name: 'GITHUB_TOKEN' })).status).toBe(200);
    expect(onDisk()).toEqual({ 'global/GITHUB_TOKEN': 'ghp_global' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(((await call('GET')).body as { scope: string }[]).map((s) => s.scope)).toEqual(['global']);
    expect(await secretsEnv('scratch')).toMatchObject({ GITHUB_TOKEN: 'ghp_global' });
  });

  it('never calls the Keychain', () => {
    expect(existsSync(securityLog)).toBe(false);
  });
});
