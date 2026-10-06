import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileQuery, mentionTokens, pickFile } from '../shared/mention-menu.ts';
import { startRunner } from './runner-boot.ts';

// The composer's `@` menu: which file is being typed, what the server lists, and what a sent message's tokens resolve to.

describe('fileQuery: the file being typed at the caret', () => {
  it.each([
    ['@', 1, '', 0, 1],
    ['look at @src/ap', 15, 'src/ap', 8, 15],
    ['@a and more', 2, 'a', 0, 2],
    ['see @README.md', 14, 'README.md', 4, 14],
  ])('%j caret %i', (text, caret, query, start, end) => {
    expect(fileQuery(text, caret)).toEqual({ query, start, end });
  });

  it.each([
    ['ben@askphill.com', 16],
    ['no mention here', 5],
    ['@@x', 3],
    ['a/@x', 4],
  ])('%j caret %i is not a mention', (text, caret) => {
    expect(fileQuery(text, caret)).toBeNull();
  });

  it('picks a file in place, keeping what follows', () => {
    const at = fileQuery('read @ser and go', 9)!;
    expect(pickFile('read @ser and go', at, 'server/app.ts')).toEqual({ text: 'read @server/app.ts and go', caret: 'read @server/app.ts '.length });
    const end = fileQuery('read @ser', 9)!;
    expect(pickFile('read @ser', end, 'a.ts').text).toBe('read @a.ts ');
  });
});

describe('mentionTokens', () => {
  it('lists each path once, without trailing punctuation or addresses', () => {
    expect(mentionTokens('compare @a/b.ts, @a/b.ts and @artifacts/r.html. mail ben@x.com')).toEqual(['a/b.ts', 'artifacts/r.html']);
  });
});

const r = await startRunner({});
const { mentionsApi } = await import('../server/mentions-api.ts');
const { resolveMentions, withMentions } = await import('../server/mentions.ts');

const repo = join(r.tmp, 'repo');
mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'README.md'), 'hi');
writeFileSync(join(repo, 'src', 'app.ts'), 'x');
writeFileSync(join(repo, 'src', 'panel.ts'), 'x');
const thread = r.db.threads.create({
  id: randomUUID(), channel_id: 'scratch', title: 'T', status: 'done', role: null, model: null, session_id: randomUUID(),
  cwd: repo, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
});
const artDir = join(r.tmp, 'art');
mkdirSync(artDir, { recursive: true });
writeFileSync(join(artDir, 'report.html'), '<p>');
r.db.artifacts.upsert({ thread_id: thread.id, path: join(artDir, 'report.html'), name: 'report.html', kind: 'html', size: 3 });

const get = async (q: string) => (await mentionsApi.request(`/?${q}`)).json();

describe('GET /api/mentions', () => {
  it("lists the thread's artifacts before the repo's files", async () => {
    const rows = await get(`thread=${thread.id}&q=`);
    expect(rows[0]).toMatchObject({ insert: 'artifacts/report.html', kind: 'artifact' });
    expect(rows.map((x: { insert: string }) => x.insert)).toEqual(expect.arrayContaining(['README.md', 'src/app.ts']));
  });

  it('ranks a name match above a path match', async () => {
    const rows = await get(`thread=${thread.id}&q=app`);
    expect(rows.map((x: { insert: string }) => x.insert)).toEqual(['src/app.ts']);
  });

  it('is empty when nothing matches, and 404 for an unknown thread', async () => {
    expect(await get(`thread=${thread.id}&q=zzzz`)).toEqual([]);
    expect((await mentionsApi.request('/?thread=nope')).status).toBe(404);
  });
});

describe('resolving a sent message', () => {
  const opts = { cwd: repo, threadId: thread.id };

  it('names the artifact and repo files it mentions, by absolute path', () => {
    const found = resolveMentions('check @artifacts/report.html against @src/app.ts, then @src.', opts);
    expect(found).toEqual([
      { token: 'artifacts/report.html', path: join(artDir, 'report.html'), kind: 'artifact' },
      { token: 'src/app.ts', path: join(repo, 'src', 'app.ts'), kind: 'file' },
      { token: 'src', path: join(repo, 'src'), kind: 'folder' },
    ]);
  });

  it('leaves text that is not a file alone, and never leaves the repo', () => {
    expect(resolveMentions('mail ben@x.com, ask @someone or read @../../etc/passwd or @/etc/passwd', opts)).toEqual([]);
    expect(withMentions('hello @nobody', opts)).toBe('hello @nobody');
  });

  it('appends a block the agent can read paths from', () => {
    const text = withMentions('see @README.md', opts);
    expect(text).toContain('see @README.md\n\n## Mentioned files');
    expect(text).toContain(`- @README.md (file): ${join(repo, 'README.md')}`);
  });
});
