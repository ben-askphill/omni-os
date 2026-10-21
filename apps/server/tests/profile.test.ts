import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Who uses this Omni: GET and PUT /api/profile, the name in /api/status, and the prompts that name the user
// instead of a hardcoded one. Empty until onboarding sets it; kept in the user config file, not the database.

const r = await startRunner();
const { app } = await import('../app.ts');
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { describeAttachments } = await import('../uploads.ts');
const { describeMentions } = await import('../mentions.ts');

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

const thread = async () => {
  const t = await r.start('THINK:1');
  await r.untilResults(t.id, 1);
  return { thread: r.thread(t.id), channel: r.db.channels.get('scratch')! };
};

describe('profile', () => {
  it('starts empty, and status carries it', async () => {
    expect(await json(await send('GET', '/api/profile'))).toMatchObject({ name: '', pronouns: 'they/them', onboarded: false });
    expect((await json(await send('GET', '/api/status'))).profile).toMatchObject({ name: '', onboarded: false });
  });

  it('prompts say "the user" until a name is set', async () => {
    const { thread: t, channel } = await thread();
    const prompt = buildSystemPrompt(t, channel);
    expect(prompt).toContain("the user's local agent workspace");
    expect(prompt).not.toContain('You work for');
    expect(prompt).not.toMatch(/\bBen\b/);
    expect(describeAttachments([{ name: 'a.txt', path: '/x/a.txt', size: 1, image: false, mime: 'text/plain' } as any])).toContain('the user attached this file');
    expect(describeMentions([])).toContain('the user referred to these');
  });

  it('refuses an empty or too long name', async () => {
    expect((await send('PUT', '/api/profile', { name: '   ' })).status).toBe(400);
    expect((await send('PUT', '/api/profile', { name: 'x'.repeat(61) })).status).toBe(400);
    expect((await send('PUT', '/api/profile', { email: 'not-an-email' })).status).toBe(400);
    expect((await send('PUT', '/api/profile', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await json(await send('GET', '/api/profile'))).name).toBe('');
  });

  it('saves a trimmed name and uses it everywhere', async () => {
    expect((await json(await send('PUT', '/api/profile', { name: '  Tijs   Internet ' }))).name).toBe('Tijs Internet');
    expect((await json(await send('GET', '/api/profile'))).name).toBe('Tijs Internet');
    expect((await json(await send('GET', '/api/status'))).profile.name).toBe('Tijs Internet');

    const { thread: t, channel } = await thread();
    const prompt = buildSystemPrompt(t, channel);
    expect(prompt).toContain("Tijs Internet's local agent workspace");
    expect(prompt).toContain('- You work for Tijs Internet.');
    expect(prompt).toContain('meant for Tijs Internet into');
    expect(describeAttachments([{ name: 'a.txt', path: '/x/a.txt', size: 1, image: false, mime: 'text/plain' } as any])).toContain('Tijs Internet attached this file');
    expect(describeMentions([])).toContain('Tijs Internet referred to these');
  });

  it('keeps the name in data/omni.config.json, not the database', async () => {
    const file = JSON.parse(readFileSync(join(process.env.OMNI_DATA_DIR!, 'omni.config.json'), 'utf8'));
    expect(file.user.name).toBe('Tijs Internet');
    expect(r.db.kv.get('profile')).toBeUndefined();
  });

  it('asks the browser takeover in the configured pronoun', async () => {
    await send('PUT', '/api/profile', { pronouns: 'she/her' });
    const { thread: t, channel } = await thread();
    expect(buildSystemPrompt(t, channel)).not.toMatch(/\bBen\b/);
    await send('PUT', '/api/profile', { pronouns: 'they/them' });
  });
});
