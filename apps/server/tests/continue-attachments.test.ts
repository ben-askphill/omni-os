import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

vi.mock('../secrets.ts', async (original) => ({
  ...(await original<typeof import('../secrets.ts')>()),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));

// Carrying selected attachments into a continued thread (apps/server/continue-attachments.ts), through the API and the
// real runner against the fake claude, codex and cursor-agent CLIs.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
let C: typeof import('../continue.ts');
let uploadsDir: typeof import('../config.ts')['uploadsDir'];

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex', 'cursor']);
  ({ app } = await import('../app.ts'));
  C = await import('../continue.ts');
  ({ uploadsDir } = await import('../config.ts'));
});

afterEach(() => {
  C.continueHooks.captured = async () => {};
  H.config.maxUploadMb = 25;
});

const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
const codex = { harness: 'codex', model: '', effort: '' };
const cursor = { harness: 'cursor', model: '', effort: '' };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text } as { status: number; body: any };
};
const preview = (id: string, run: object, attachments?: string[]) => call('POST', `/threads/${id}/continue/preview`, { ...run, attachments });
const start = async (id: string, run: object, text: string, attachments?: string[], request_id = randomUUID()) => {
  const p = await preview(id, run, attachments);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return call('POST', `/threads/${id}/continue`, { ...run, text, attachments, request_id, revision: p.body.revision });
};
const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const threadDirs = () => readdirSync(H.paths.threads).sort();

const file = (name: string, text: string, type = 'text/plain') => new File([Buffer.from(text, 'latin1')], name, { type });
const PNG = '\x89PNG fake data';

/** A finished claude thread with these files attached to its first message. */
async function source(attached: File[], prompt = 'look at these') {
  const t = await H.runner.createThread({ channel: 'scratch', prompt, ...claude, files: attached });
  await H.untilResults(t.id, 1);
  return H.thread(t.id);
}
const idsOf = (p: any) => p.carryover.attachments.map((a: any) => a.id) as string[];
const byName = (p: any, name: string) => p.carryover.attachments.find((a: any) => a.name === name);
const codexTurn = (id: string) => H.codexRequests().find((r) => r.method === 'turn/start' && r.thread_id === id);
/** Where the new thread's copy of a file is, from the first message's own attachment record. */
const sentFiles = (id: string): { name: string; path: string; size: number }[] => H.byKind(id, 'user')[0].p.attachments ?? [];

describe('what the preview shows', () => {
  it('lists each attachment with its type, size and whether it can be carried, and carries none unless picked', async () => {
    const src = await source([file('shot.png', PNG, 'image/png'), file('notes.txt', 'some notes')]);
    const p = await preview(src.id, codex);
    expect(p.status).toBe(200);
    expect(p.body.carryover.attachments).toMatchObject([
      { name: 'shot.png', mime: 'image/png', size: PNG.length, image: true, availability: 'available', reason: null, selected: false, carried: false, as: 'inline' },
      { name: 'notes.txt', mime: 'text/plain', size: 10, image: false, availability: 'available', reason: null, selected: false, carried: false, as: 'path' },
    ]);
    expect(p.body.carryover.omitted).toContainEqual(expect.objectContaining({ what: 'attachments', count: 2 }));
    expect(p.body.carryover.text).toContain('2 attachments were not carried: shot.png (not selected); notes.txt (not selected).');
    expect(p.body.carryover.text).not.toContain(uploadsDir(src.id));
  });

  it('says per harness whether an image goes inline: Claude and Codex inline, Cursor by path', async () => {
    const src = await source([file('shot.png', PNG, 'image/png')]);
    const as = async (run: object) => byName((await preview(src.id, run)).body, 'shot.png').as;
    expect(await as(claude)).toBe('inline');
    expect(await as(codex)).toBe('inline');
    expect(await as(cursor)).toBe('path');
  });

  it('changes the revision with the picks, and marks only what was picked', async () => {
    const src = await source([file('a.txt', 'a'), file('b.txt', 'b')]);
    const none = (await preview(src.id, codex)).body;
    const [a] = idsOf(none);
    const one = (await preview(src.id, codex, [a])).body;
    expect(one.revision).not.toBe(none.revision);
    expect(one.carryover.attachments.map((x: any) => [x.name, x.selected, x.carried])).toEqual([['a.txt', true, true], ['b.txt', false, false]]);
    expect(one.carryover.text).toContain('Attachments carried, copied into your own uploads folder and listed with the first message you read: a.txt.');
    expect((await preview(src.id, codex, [a])).body.revision).toBe(one.revision);
  });
});

describe('carrying files', () => {
  it('copies the picked files into the new thread\'s own uploads, and each harness takes them its own way', async () => {
    const src = await source([file('shot.png', PNG, 'image/png'), file('notes.txt', 'some notes'), file('skip.txt', 'not this one')]);
    const before = { uploads: files(uploadsDir(src.id)), events: H.events(src.id) };
    const [shot, notes] = idsOf((await preview(src.id, codex)).body);
    const res = await start(src.id, codex, 'use the files', [shot, notes]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.thread.id as string;
    await H.untilResults(id, 1);

    expect(files(uploadsDir(id))).toEqual(['notes.txt', 'shot.png']);
    expect(readFileSync(join(uploadsDir(id), 'shot.png'), 'latin1')).toBe(PNG);
    expect(readFileSync(join(uploadsDir(id), 'notes.txt'), 'utf8')).toBe('some notes');
    expect(sentFiles(id).map((a) => a.path), 'the paths are the new thread\'s own').toEqual([join(uploadsDir(id), 'shot.png'), join(uploadsDir(id), 'notes.txt')]);
    expect(files(uploadsDir(src.id)), 'the source keeps its files').toEqual(before.uploads);
    expect(H.events(src.id)).toEqual(before.events);

    const input = codexTurn(id).params.input;
    expect(input.find((i: any) => i.type === 'localImage').path).toBe(join(uploadsDir(id), 'shot.png'));
    const text = input.find((i: any) => i.type === 'text').text as string;
    expect(text).toContain(`notes.txt (text/plain, 1 KB): ${join(uploadsDir(id), 'notes.txt')}`);
    expect(text).not.toContain(uploadsDir(src.id));
    expect(text).toContain('skip.txt (not carried: not selected)');
    expect(text).toContain('Attachments carried, copied into your own uploads folder');

    const mine = (await call('GET', `/threads/${id}`)).body;
    expect(mine.continued_from.carried.attachments).toBe(2);
  });

  it('reaches Cursor as a path note, and Claude as an image', async () => {
    const src = await source([file('shot.png', PNG, 'image/png')]);
    const [shot] = idsOf((await preview(src.id, cursor)).body);

    const onCursor = (await start(src.id, cursor, 'see it', [shot])).body.thread.id as string;
    await H.untilResults(onCursor, 1);
    const turn = H.cursorRequests().find((r) => r.method === 'turn' && r.thread_id === onCursor);
    expect(turn.prompt).toContain(`shot.png (image/png, 1 KB): ${join(uploadsDir(onCursor), 'shot.png')}`);
    expect(turn.prompt).not.toContain(uploadsDir(src.id));

    const onClaude = (await start(src.id, claude, 'see it', [shot])).body.thread.id as string;
    await H.untilResults(onClaude, 1);
    expect(H.claudeTexts(onClaude)[0]).toContain(`${join(uploadsDir(onClaude), 'shot.png')} (also included as an image in this message)`);
  });

  it('gives same-named files names of their own and never overwrites one', async () => {
    const src = await source([file('a.txt', 'first')]);
    await H.runner.sendMessage(src.id, 'and another a.txt', { attachments: await import('../uploads.ts').then((u) => u.saveUploads(src.id, [file('a.txt', 'second')])) });
    await H.untilResults(src.id, 2);
    expect(files(uploadsDir(src.id))).toEqual(['a-2.txt', 'a.txt']);
    // The other Mac's transcript can name the same file twice.
    H.db.events.add(src.id, 'user', { text: 'same name again', attachments: [{ name: 'a.txt', path: '/other-mac/uploads/a.txt', size: 5, mime: 'text/plain', image: false }] });
    const ids = idsOf((await preview(src.id, claude)).body);
    expect(ids).toHaveLength(3);

    const id = (await start(src.id, claude, 'all of them', ids)).body.thread.id as string;
    await H.untilResults(id, 1);
    expect(files(uploadsDir(id))).toEqual(['a-2.txt', 'a-3.txt', 'a.txt']);
    expect(['a.txt', 'a-2.txt', 'a-3.txt'].map((n) => readFileSync(join(uploadsDir(id), n), 'utf8'))).toEqual(['first', 'second', 'first']);
  });

  it('carries a carried file on along a chain of continued threads', async () => {
    const src = await source([file('notes.txt', 'chain me')]);
    const [n] = idsOf((await preview(src.id, claude)).body);
    const b = (await start(src.id, claude, 'one', [n])).body.thread.id as string;
    await H.untilResults(b, 1);
    const [nb] = idsOf((await preview(b, codex)).body);
    expect(byName((await preview(b, codex)).body, 'notes.txt')).toMatchObject({ availability: 'available' });
    const c = (await start(b, codex, 'two', [nb])).body.thread.id as string;
    await H.untilResults(c, 1);
    expect(readFileSync(join(uploadsDir(c), 'notes.txt'), 'utf8')).toBe('chain me');
    expect(sentFiles(c)[0].path).toBe(join(uploadsDir(c), 'notes.txt'));
  });
});

describe('what cannot be carried', () => {
  it('names a file whose bytes are gone, and goes on without it', async () => {
    const src = await source([file('here.txt', 'here'), file('gone.txt', 'gone')]);
    rmSync(join(uploadsDir(src.id), 'gone.txt'));
    const ids = idsOf((await preview(src.id, claude)).body);
    const p = (await preview(src.id, claude, ids)).body;
    expect(byName(p, 'gone.txt')).toMatchObject({ availability: 'missing', carried: false, selected: true, as: null, reason: expect.stringContaining('not on this Mac') });
    expect(p.carryover.omitted).toContainEqual(expect.objectContaining({ what: 'attachments', count: 1, note: expect.stringContaining('gone.txt (Its bytes are not on this Mac') }));
    const id = (await start(src.id, claude, 'go', ids)).body.thread.id as string;
    await H.untilResults(id, 1);
    expect(files(uploadsDir(id))).toEqual(['here.txt']);
    expect(H.claudeTexts(id)[0].split("the user's message:")[1], 'no attachment note for it after the message').not.toContain('gone.txt');
  });

  it('names a file over the limit, and the ones past the total', async () => {
    const src = await source([file('big.txt', 'x'.repeat(2000)), ...'abcde'.split('').map((n) => file(`${n}.txt`, n.repeat(650)))]);
    // Seven hundred bytes a file, and four files' worth in all.
    H.config.maxUploadMb = 700 / 1024 / 1024;
    const all = idsOf((await preview(src.id, claude)).body);
    const p = (await preview(src.id, claude, all)).body;
    expect(byName(p, 'big.txt')).toMatchObject({ availability: 'oversize', carried: false, reason: expect.stringContaining('limit for one file') });
    expect(['a', 'b', 'c', 'd'].map((n) => byName(p, `${n}.txt`).carried)).toEqual([true, true, true, true]);
    expect(byName(p, 'e.txt')).toMatchObject({ availability: 'oversize', carried: false, selected: true, reason: expect.stringContaining('past the') });
    expect(p.carryover.omitted).toContainEqual(expect.objectContaining({ what: 'attachments', count: 2 }));
    const id = (await start(src.id, claude, 'go', all)).body.thread.id as string;
    await H.untilResults(id, 1);
    expect(files(uploadsDir(id))).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
  });

  it('does not follow a link, whatever it points at', async () => {
    const src = await source([file('real.txt', 'real'), file('link.txt', 'placeholder')]);
    const secret = join(H.tmp, 'secret.txt');
    writeFileSync(secret, 'do not copy me');
    rmSync(join(uploadsDir(src.id), 'link.txt'));
    symlinkSync(secret, join(uploadsDir(src.id), 'link.txt'));
    const ids = idsOf((await preview(src.id, claude)).body);
    const p = (await preview(src.id, claude, ids)).body;
    expect(byName(p, 'link.txt')).toMatchObject({ availability: 'unsupported', carried: false, reason: expect.stringContaining('link') });
    const id = (await start(src.id, claude, 'go', ids)).body.thread.id as string;
    await H.untilResults(id, 1);
    expect(files(uploadsDir(id))).toEqual(['real.txt']);
    expect(readdirSync(uploadsDir(id)).map((n) => readFileSync(join(uploadsDir(id), n), 'utf8'))).not.toContain('do not copy me');
  });

  it('reads a name by its last segment only, so a path in a name reaches nothing outside the uploads folder', async () => {
    const src = await source([file('plain.txt', 'plain')]);
    writeFileSync(join(H.paths.threads, src.id, 'outside.txt'), 'outside the uploads folder');
    writeFileSync(join(H.tmp, 'abs.txt'), 'an absolute path');
    const evil = [
      { name: '../outside.txt', path: join(H.paths.threads, src.id, 'outside.txt'), size: 26, mime: 'text/plain', image: false },
      { name: join(H.tmp, 'abs.txt'), path: join(H.tmp, 'abs.txt'), size: 16, mime: 'text/plain', image: false },
      { name: '..\\..\\outside.txt', path: 'x', size: 26, mime: 'text/plain', image: false },
      { name: '..', path: 'x', size: 1, mime: 'text/plain', image: false },
    ];
    H.db.events.add(src.id, 'user', { text: 'evil names', attachments: evil });
    const ids = idsOf((await preview(src.id, claude)).body);
    expect(ids).toHaveLength(5);
    const p = (await preview(src.id, claude, ids)).body;
    expect(p.carryover.attachments.map((a: any) => [a.carried, a.availability])).toEqual([[true, 'available'], ...Array(3).fill([false, 'missing']), [false, 'unsupported']]);
    const id = (await start(src.id, claude, 'go', ids)).body.thread.id as string;
    await H.untilResults(id, 1);
    expect(files(uploadsDir(id))).toEqual(['plain.txt']);
    expect(files(join(H.paths.threads, id)).filter((n) => n.endsWith('.txt'))).toEqual([]);
  });

  it('refuses the start when a picked file was swapped for a link after the preview, and leaves nothing behind', async () => {
    const src = await source([file('notes.txt', 'as attached')]);
    const [n] = idsOf((await preview(src.id, claude)).body);
    const p = (await preview(src.id, claude, [n])).body;
    const secret = join(H.tmp, 'swapped.txt');
    writeFileSync(secret, 'swapped in');
    rmSync(join(uploadsDir(src.id), 'notes.txt'));
    symlinkSync(secret, join(uploadsDir(src.id), 'notes.txt'));
    const dirs = threadDirs();
    const res = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', attachments: [n], request_id: 'swap-1', revision: p.revision });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('changed');
    expect(byName(res.body.preview, 'notes.txt')).toMatchObject({ availability: 'unsupported', carried: false });
    expect(threadDirs(), 'no folder of a thread that was never made').toEqual(dirs);
    expect(H.db.continuations.continuedIn(src.id)).toEqual([]);
  });

  it('refuses the start when a picked file changed between the preview and the copy, and leaves nothing behind', async () => {
    const src = await source([file('notes.txt', 'as attached')]);
    const [n] = idsOf((await preview(src.id, claude)).body);
    const p = (await preview(src.id, claude, [n])).body;
    const dirs = threadDirs();
    C.continueHooks.captured = async () => {
      // Same size, same name, other bytes: only the file's identity gives it away.
      rmSync(join(uploadsDir(src.id), 'notes.txt'));
      writeFileSync(join(uploadsDir(src.id), 'notes.txt'), 'as attacheD');
    };
    const res = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', attachments: [n], request_id: 'swap-2', revision: p.revision });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('changed');
    expect(threadDirs()).toEqual(dirs);
  });
});

describe('cancelling and retrying', () => {
  it('writes nothing for a preview, however many are asked and dropped', async () => {
    const src = await source([file('notes.txt', 'keep me')]);
    const [n] = idsOf((await preview(src.id, claude)).body);
    const dirs = threadDirs();
    for (let i = 0; i < 3; i++) await preview(src.id, codex, [n]);
    expect(threadDirs()).toEqual(dirs);
    expect(H.db.continuations.continuedIn(src.id)).toEqual([]);
  });

  it('gives a retried start the same thread and the same files, even two at once', async () => {
    const src = await source([file('notes.txt', 'once')]);
    const [n] = idsOf((await preview(src.id, claude)).body);
    const p = (await preview(src.id, claude, [n])).body;
    const body = { ...claude, text: 'go', attachments: [n], request_id: 'again-1', revision: p.revision };
    const [a, b] = await Promise.all([call('POST', `/threads/${src.id}/continue`, body), call('POST', `/threads/${src.id}/continue`, body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.thread.id).toBe(b.body.thread.id);
    const id = a.body.thread.id as string;
    expect((await call('POST', `/threads/${src.id}/continue`, body)).body).toMatchObject({ duplicate: true, thread: { id } });
    await H.untilResults(id, 1);
    expect(files(uploadsDir(id))).toEqual(['notes.txt']);
    expect(H.db.continuations.continuedIn(src.id).map((t) => t.id)).toEqual([id]);
    expect(threadDirs().filter((d) => d === id)).toHaveLength(1);
    expect(H.texts(id, 'user')).toEqual(['go']);
  });

  it('refuses a request id reused with other picks', async () => {
    const src = await source([file('a.txt', 'a'), file('b.txt', 'b')]);
    const [a, b] = idsOf((await preview(src.id, claude)).body);
    const pa = (await preview(src.id, claude, [a])).body;
    const first = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', attachments: [a], request_id: 'reuse-1', revision: pa.revision });
    expect(first.status).toBe(200);
    const pb = (await preview(src.id, claude, [b])).body;
    const second = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', attachments: [b], request_id: 'reuse-1', revision: pb.revision });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('request_reused');
  });

  it('copies nothing when the source changes between the capture and the write', async () => {
    const src = await source([file('notes.txt', 'late')]);
    const [n] = idsOf((await preview(src.id, claude)).body);
    const dirs = threadDirs();
    C.continueHooks.captured = async () => {
      H.db.events.add(src.id, 'assistant_text', { text: 'a late reply' });
    };
    const res = await start(src.id, claude, 'go', [n]);
    expect(res.status).toBe(409);
    expect(threadDirs()).toEqual(dirs);
  });
});

describe('before the thread launches', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

  it('keeps the files with the first message through a failed setup, and sends them once, on Retry', async () => {
    const dir = join(H.tmp, 'repo-att');
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'start');
    H.db.channels.create({ id: 'repo-att', name: 'repo-att', repo_path: dir, use_worktree: 1 });
    const src = await H.runner.createThread({ channel: 'repo-att', prompt: 'with a file', ...claude, files: [file('notes.txt', 'survive the restart')] });
    await H.untilResults(src.id, 1);
    const [n] = idsOf((await preview(src.id, claude)).body);

    let made = '';
    C.continueHooks.captured = async (id) => {
      made = id;
      mkdirSync(join(H.paths.worktrees, id), { recursive: true });
      writeFileSync(join(H.paths.worktrees, id, 'in-the-way.txt'), 'x\n');
    };
    expect((await start(src.id, claude, 'carry on', [n])).status).toBe(200);
    await H.until('setup to fail', () => H.thread(made).setup === 'failed');
    const saved = H.db.messageRequests.byRequestId(made, 'thread-start');
    expect(saved?.attachments?.map((a) => a.path)).toEqual([join(uploadsDir(made), 'notes.txt')]);
    expect(files(uploadsDir(made))).toEqual(['notes.txt']);
    expect(H.byKind(made, 'user'), 'nothing was sent yet').toEqual([]);

    rmSync(join(H.paths.worktrees, made), { recursive: true });
    expect((await call('POST', `/threads/${made}/setup/retry`)).status).toBe(200);
    await H.untilResults(made, 1);
    expect(files(uploadsDir(made))).toEqual(['notes.txt']);
    expect(sentFiles(made).map((a) => a.path)).toEqual([join(uploadsDir(made), 'notes.txt')]);
    expect(H.claudeTexts(made)[0]).toContain(`notes.txt (text/plain, 1 KB): ${join(uploadsDir(made), 'notes.txt')}`);
    expect(H.texts(made, 'user')).toEqual(['carry on']);
  }, 20_000);
});
