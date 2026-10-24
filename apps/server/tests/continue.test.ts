import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

vi.mock('../secrets.ts', async (original) => ({
  ...(await original<typeof import('../secrets.ts')>()),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));

// Continuing an idle thread on another local harness (apps/server/continue.ts), through the API and the real runner,
// against the fake claude, codex and cursor-agent CLIs and throwaway git repos. Codex has one slot, so a thread can be
// made to wait for it.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
let C: typeof import('../continue.ts');
let continueRef: typeof import('../continue-carry.ts')['continueRef'];

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR, OMNI_MAX_CONCURRENT_CODEX: '1' });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex', 'cursor']);
  ({ app } = await import('../app.ts'));
  C = await import('../continue.ts');
  ({ continueRef } = await import('../continue-carry.ts'));
});

afterEach(() => {
  C.continueHooks.captured = async () => {};
});

const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
const codex = { harness: 'codex', model: '', effort: '' };
const cursor = { harness: 'cursor', model: '', effort: '' };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text } as { status: number; body: any };
};
const preview = (id: string, run: object) => call('POST', `/threads/${id}/continue/preview`, run);
/** Preview, then start with that preview's revision. */
const start = async (id: string, run: object, text: string, request_id = randomUUID()) => {
  const p = await preview(id, run);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  return call('POST', `/threads/${id}/continue`, { ...run, text, request_id, revision: p.body.revision });
};
const detail = async (id: string) => (await call('GET', `/threads/${id}`)).body;
const codexInputs = (id: string): string[] =>
  H.codexRequests()
    .filter((r) => r.method === 'turn/start' && r.thread_id === id)
    .map((r) => r.params.input[0].text);
const continuedIn = (id: string) => H.db.continuations.continuedIn(id).map((t) => t.id);

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
/** A git repo with a .gitignore and a few committed files, in a channel with worktrees on unless `shared`. */
function repoChannel(shared = false) {
  const dir = join(H.tmp, `repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), '.env\n');
  for (const f of ['a.txt', 'b.txt', 'del.txt']) writeFileSync(join(dir, f), `${f} as committed\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  const id = `repo-${n}`;
  H.db.channels.create({ id, name: id, repo_path: dir, use_worktree: shared ? 0 : 1 });
  return { dir, channel: id };
}

/** Every file under dir but .git, with its text or, for a symlink, where it points. */
function files(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(join(dir, rel))) {
    if (name === '.git') continue;
    const path = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(dir, path));
    if (st.isSymbolicLink()) out[path] = `-> ${readlinkSync(join(dir, path))}`;
    else if (st.isDirectory()) Object.assign(out, files(dir, path));
    else out[path] = readFileSync(join(dir, path), 'latin1');
  }
  return out;
}

const idle = async (prompt: string, run: Record<string, unknown> = claude) => {
  const t = await H.start(prompt, run);
  await H.untilResults(t.id, 1);
  return H.thread(t.id);
};

describe('continuing a thread on another harness', () => {
  it('gives the new session the Carryover ahead of the message, and leaves the source as it was', async () => {
    const src = await idle('remember the word PAPAYA');
    const before = { events: H.events(src.id), thread: H.thread(src.id) };

    const res = await start(src.id, codex, 'what word?');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.duplicate).toBe(false);
    const id = res.body.thread.id as string;
    await H.untilResults(id, 1);

    const [sent] = codexInputs(id);
    expect(sent.startsWith('<omni-carryover>\nYou are starting a new Omni thread that continues')).toBe(true);
    expect(sent).toContain('the user started this one on Codex');
    expect(sent).toContain('[the user] remember the word PAPAYA');
    expect(sent.endsWith("</omni-carryover>\n\nthe user's message:\nwhat word?")).toBe(true);
    expect(H.texts(id, 'user'), 'the transcript keeps only what was typed').toEqual(['what word?']);
    expect(H.byKind(id, 'carryover')[0].p).toMatchObject({ source: { id: src.id, run: { harness: 'claude-code' } }, goal: 'remember the word PAPAYA' });
    expect(H.byKind(id, 'handover')[0].p).toMatchObject({ session: 'fresh', to: { harness: 'codex' } });

    expect(H.thread(id)).toMatchObject({ continued_from: src.id, parent_id: null, task_id: null, harness: 'codex', channel_id: 'scratch', source: 'manual' });
    expect(H.thread(id).title).toBe(`${before.thread.title} (continued)`);
    expect(H.events(src.id), 'the source transcript').toEqual(before.events);
    expect(H.thread(src.id)).toMatchObject({ session_id: before.thread.session_id, status: before.thread.status, has_run: 1, harness: 'claude-code' });
    expect(H.byKind(src.id, 'crew_report'), 'no report to the source').toEqual([]);

    const mine = await detail(id);
    expect(mine.continued_from).toMatchObject({ id: src.id, harness: 'claude-code', carried: { entries: 2, omitted: 0 } });
    expect(mine.continued_in).toEqual([]);
    expect((await detail(src.id)).continued_in).toMatchObject([{ id, harness: 'codex', carried: { entries: 2 } }]);
  });

  it('starts on Cursor Agent with the Carryover too', async () => {
    const src = await idle('remember the word FIG');
    const res = await start(src.id, cursor, 'which fruit?');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.thread.id;
    await H.untilResults(id, 1);
    const turn = H.cursorRequests().find((r) => r.method === 'turn' && r.thread_id === id);
    expect(turn.prompt).toContain('<omni-carryover>');
    expect(turn.prompt).toContain('[the user] remember the word FIG');
    expect(turn.prompt.endsWith('which fruit?')).toBe(true);
  });

  it('carries the first goal along a chain of continued threads', async () => {
    const a = await idle('THE FIRST GOAL');
    const b = (await start(a.id, claude, 'step two')).body.thread.id;
    await H.untilResults(b, 1);
    const c = (await start(b, claude, 'step three')).body.thread.id;
    await H.untilResults(c, 1);
    const text = H.claudeTexts(c)[0];
    expect(text).toContain('Goal, the message the work started from:\nTHE FIRST GOAL');
    expect(text).toContain('[Carried over from "');
    expect((await detail(b))).toMatchObject({ continued_from: { id: a.id }, continued_in: [{ id: c }] });
  });

  it('refuses Hermes and Cursor Cloud as the new harness, and a thread on them as the source', async () => {
    const src = await idle('local work');
    for (const harness of ['hermes', 'cursor-cloud']) {
      const res = await preview(src.id, { harness, model: '', effort: '' });
      expect(res.status, harness).toBe(400);
      expect(res.body.error).toMatch(/cannot (move there|start from)/);
    }
    expect((await preview(src.id, { ...claude, model: 'auto' })).status).toBe(400);

    const remote = H.db.threads.create({
      id: `remote-${++n}`, channel_id: 'scratch', title: 'On Hermes', status: 'done', role: null, model: null, harness: 'hermes',
      session_id: 'omni-x', cwd: H.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, has_run: 1,
    });
    H.db.events.add(remote.id, 'user', { text: 'hello' });
    const p = await preview(remote.id, claude);
    expect(p.body.blocked).toMatchObject({ code: 'remote' });
    const res = await call('POST', `/threads/${remote.id}/continue`, { ...claude, text: 'go', request_id: 'r', revision: p.body.revision });
    expect(res).toMatchObject({ status: 409, body: { code: 'busy', block: { code: 'remote' } } });
  });

  it('hands the Carryover to the harness picked before the first turn', async () => {
    const blocker = await H.start('HANG hold the codex slot', codex);
    await H.until('the blocker in its turn', () => codexInputs(blocker.id).length === 1);
    const src = await idle('remember the word GUAVA');
    const id = (await start(src.id, codex, 'what word?')).body.thread.id;
    expect(H.runner.pendingFor(id).map((m) => m.state), 'waiting for the codex slot').toEqual(['waiting']);

    expect((await call('POST', `/threads/${id}/run`, claude)).status).toBe(200);
    await H.untilResults(id, 1);
    const [text] = H.claudeTexts(id);
    expect(text.startsWith('<omni-carryover>')).toBe(true);
    expect(text).toContain('the user started this one on Claude Code');
    expect(text).toContain('[the user] remember the word GUAVA');
    expect(text.endsWith('what word?')).toBe(true);
    expect(codexInputs(id)).toEqual([]);
    H.runner.interruptThread(blocker.id);
    await H.untilResults(blocker.id, 1);
  }, 20_000);

  it('shows a shell open in the Terminal tab as what blocks it', async () => {
    const src = await idle('quiet work');
    const { openTerminal, closeTerminal } = await import('../terminal.ts');
    openTerminal(src.id, src.cwd);
    try {
      expect((await preview(src.id, claude)).body.blocked).toMatchObject({ code: 'terminal' });
    } finally {
      closeTerminal(src.id);
    }
    expect((await preview(src.id, claude)).body.blocked).toBeNull();
  });

  it('serves the history it leaves out by event uid', async () => {
    const src = await idle('first words');
    H.runner.sendMessage(src.id, 'second words');
    await H.untilResults(src.id, 2);
    const [first, second] = H.byKind(src.id, 'user').map((e) => H.db.events.uidOf(e.id)!);
    const through = await call('GET', `/threads/${src.id}/history?through=${first}`);
    expect(through.status).toBe(200);
    expect(through.body).toContain('[the user] first words');
    expect(through.body).not.toContain('second words');
    const after = await call('GET', `/threads/${src.id}/history?after=${first}`);
    expect(after.body).toContain('[the user] second words');
    expect(after.body).not.toContain('[the user] first words');
    expect((await call('GET', `/threads/${src.id}/history?through=${second}`)).body).toContain('second words');
    expect((await call('GET', `/threads/${src.id}/history?through=nope`)).status).toBe(404);
  });
});

describe('races', () => {
  it('refuses a start once a message ran in the source since the preview', async () => {
    const src = await idle('one');
    const p = await preview(src.id, claude);
    await H.runner.postMessage(src.id, 'two');
    await H.untilResults(src.id, 2);
    const res = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', request_id: randomUUID(), revision: p.body.revision });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'changed', preview: { blocked: null } });
    expect(res.body.preview.revision).not.toBe(p.body.revision);
    expect(continuedIn(src.id)).toEqual([]);
  });

  it('refuses while the source is running, and the preview says why', async () => {
    const src = await H.start('TOOL:1500 a long one', claude);
    await H.untilTool(src.id);
    const p = await preview(src.id, claude);
    expect(p.body.blocked).toMatchObject({ code: 'running' });
    const res = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', request_id: randomUUID(), revision: p.body.revision });
    expect(res).toMatchObject({ status: 409, body: { code: 'busy', block: { code: 'running' } } });
    await H.untilResults(src.id, 1);
    expect(continuedIn(src.id)).toEqual([]);
  });

  it('refuses when new work lands between the capture and the write, and leaves nothing behind', async () => {
    const { dir, channel } = repoChannel();
    const src = await H.runner.createThread({ channel, prompt: 'start' });
    await H.untilResults(src.id, 1);
    let made = '';
    C.continueHooks.captured = async (id) => {
      made = id;
      H.db.events.add(src.id, 'assistant_text', { text: 'a late reply' });
    };
    const res = await start(src.id, claude, 'go');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('changed');
    expect(made).not.toBe('');
    expect(H.db.threads.get(made)).toBeUndefined();
    expect(H.db.continuations.get(made)).toBeUndefined();
    expect(existsSync(join(H.paths.threads, made)), 'its data folder').toBe(false);
    expect(git(dir, 'for-each-ref', 'refs/omni/continue')).toBe('');
    expect(git(dir, 'branch', '--list', `omni/${made.slice(0, 8)}`)).toBe('');
  });

  it('lets the source and the continued thread run at once, each in its own checkout', async () => {
    const { channel } = repoChannel();
    const src = await H.runner.createThread({ channel, prompt: 'start' });
    await H.untilResults(src.id, 1);
    const id = (await start(src.id, claude, 'TOOL:800 carry on')).body.thread.id;
    await H.until('the continued thread running', () => H.thread(id).status === 'running');
    await H.runner.postMessage(src.id, 'TOOL:300 and here');
    await H.untilResults(src.id, 2);
    await H.untilResults(id, 1);
    expect(realpathSync(H.spawns(id)[0].cwd)).toBe(realpathSync(H.thread(id).cwd));
    expect(realpathSync(H.spawns(src.id).at(-1).cwd)).toBe(realpathSync(src.cwd));
    expect(H.thread(id).cwd).not.toBe(src.cwd);
  });
});

describe('duplicates', () => {
  it('gives a retried start the same thread back, even two at once', async () => {
    const src = await idle('dupe me');
    const p = await preview(src.id, claude);
    const body = { ...claude, text: 'go on', request_id: 'start-1', revision: p.body.revision };
    const [a, b] = await Promise.all([call('POST', `/threads/${src.id}/continue`, body), call('POST', `/threads/${src.id}/continue`, body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.thread.id).toBe(b.body.thread.id);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    const again = await call('POST', `/threads/${src.id}/continue`, body);
    expect(again.body).toMatchObject({ duplicate: true, thread: { id: a.body.thread.id } });
    expect(continuedIn(src.id)).toEqual([a.body.thread.id]);
    await H.untilResults(a.body.thread.id, 1);
    expect(H.texts(a.body.thread.id, 'user')).toEqual(['go on']);
  });

  it('refuses a request id used for another message', async () => {
    const src = await idle('reuse me');
    const p = await preview(src.id, claude);
    const first = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'one', request_id: 'start-2', revision: p.body.revision });
    expect(first.status).toBe(200);
    const other = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'two', request_id: 'start-2', revision: p.body.revision });
    expect(other).toMatchObject({ status: 409, body: { code: 'request_reused' } });
    await H.untilResults(first.body.thread.id, 1);
  });
});

describe('the snapshot', () => {
  /** A worktree thread whose checkout holds every kind of change, and the source's state to compare after. */
  async function dirtySource() {
    const { dir, channel } = repoChannel();
    const src = await H.runner.createThread({ channel, prompt: 'start' });
    await H.untilResults(src.id, 1);
    const at = src.cwd;
    writeFileSync(join(at, 'committed.txt'), 'committed on the branch\n');
    git(at, 'add', 'committed.txt');
    git(at, 'commit', '-q', '-m', 'on the branch');
    writeFileSync(join(at, 'a.txt'), 'a.txt staged\n');
    git(at, 'add', 'a.txt');
    writeFileSync(join(at, 'b.txt'), 'b.txt unstaged\n');
    rmSync(join(at, 'del.txt'));
    writeFileSync(join(at, 'new.txt'), 'untracked text\n');
    symlinkSync('a.txt', join(at, 'link'));
    writeFileSync(join(at, '.env'), 'SECRET=1\n');
    writeFileSync(join(at, 'bin.dat'), Buffer.from([1, 0, 2, 0, 3]));
    H.runner.sendMessage(src.id, `look at ${at}/a.txt`);
    await H.untilResults(src.id, 2);
    const index = git(at, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    const state = () => ({ head: git(at, 'rev-parse', 'HEAD'), index: readFileSync(index).toString('base64'), files: files(at), status: git(at, 'status', '--porcelain') });
    return { dir, channel, src: H.thread(src.id), state, before: state() };
  }

  it('lays the source worktree into a new branch at its HEAD, uncommitted, and touches nothing in the source', async () => {
    const { src, state, before } = await dirtySource();
    const p = await preview(src.id, codex);
    expect(p.body.workspace).toBe('worktree');
    expect(p.body.carryover.omitted).toContainEqual(expect.objectContaining({ what: 'untracked', count: 1, note: expect.stringContaining('bin.dat') }));
    const res = await call('POST', `/threads/${src.id}/continue`, { ...codex, text: 'carry on', request_id: randomUUID(), revision: p.body.revision });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.thread.id;
    await H.untilResults(id, 1);
    const t = H.thread(id);

    expect(t.cwd).toBe(join(H.paths.worktrees, id));
    expect(git(t.cwd, 'branch', '--show-current')).toBe(t.branch);
    expect(git(t.cwd, 'rev-parse', 'HEAD')).toBe(before.head);
    expect(files(t.cwd)).toEqual({
      '.gitignore': '.env\n',
      'a.txt': 'a.txt staged\n',
      'b.txt': 'b.txt unstaged\n',
      'committed.txt': 'committed on the branch\n',
      link: '-> a.txt',
      'new.txt': 'untracked text\n',
    });
    expect(git(t.cwd, 'status', '--porcelain').split('\n').map((l) => l.trim()).sort()).toEqual(['?? link', '?? new.txt', 'D del.txt', 'M a.txt', 'M b.txt']);
    expect(git(t.cwd, 'rev-parse', `${continueRef(id)}^`)).toBe(before.head);
    expect(H.db.threadBases.get(id)?.sha).toBe(H.db.threadBases.get(src.id)?.sha);
    expect(state(), 'the source checkout').toEqual(before);

    const [sent] = codexInputs(id);
    expect(sent).toContain('look at ./a.txt');
    expect(sent).not.toContain(src.cwd);
    expect(sent).not.toContain(realpathSync(src.cwd));
  });

  it('converges when Retry follows a failure partway through', async () => {
    const { src } = await dirtySource();
    let made = '';
    C.continueHooks.captured = async (id) => {
      made = id;
      mkdirSync(join(H.paths.worktrees, id), { recursive: true });
      writeFileSync(join(H.paths.worktrees, id, 'in-the-way.txt'), 'x\n');
    };
    expect((await start(src.id, claude, 'carry on')).status).toBe(200);
    await H.until('setup to fail', () => H.thread(made).setup === 'failed');
    expect(H.thread(made).setup_error).toMatch(/in the way/);
    const sha = H.db.continuations.get(made)!.snapshot_sha;
    expect(sha).toBeTruthy();
    rmSync(join(H.paths.worktrees, made), { recursive: true });
    expect((await call('POST', `/threads/${made}/setup/retry`)).status).toBe(200);
    await H.untilResults(made, 1);
    expect(H.db.continuations.get(made)).toMatchObject({ snapshot_sha: sha, applied_at: expect.any(String) });
    expect(readFileSync(join(H.thread(made).cwd, 'b.txt'), 'utf8')).toBe('b.txt unstaged\n');
    expect(H.texts(made, 'user')).toEqual(['carry on']);
  });

  it('fails setup, saying why, when its branch name is taken at another commit', async () => {
    const { dir, src } = await dirtySource();
    let made = '';
    C.continueHooks.captured = async (id) => {
      made = id;
      git(dir, 'branch', `omni/${id.slice(0, 8)}`, 'main');
    };
    expect((await start(src.id, claude, 'carry on')).status).toBe(200);
    await H.until('setup to fail', () => H.thread(made).setup === 'failed');
    expect(H.thread(made).setup_error).toMatch(/already exists at another commit/);
    expect(H.spawns(made)).toEqual([]);
  });

  it('gives a source in the shared checkout its own worktree at HEAD, and lists its uncommitted changes instead', async () => {
    const { dir, channel } = repoChannel(true);
    const src = await H.runner.createThread({ channel, prompt: 'start' });
    await H.untilResults(src.id, 1);
    expect(src.cwd).toBe(dir);
    writeFileSync(join(dir, 'a.txt'), 'edited in the shared checkout\n');
    writeFileSync(join(dir, 'dirty.txt'), 'not mine\n');
    const p = await preview(src.id, claude);
    expect(p.body.workspace).toBe('worktree');
    expect(p.body.carryover.omitted).toContainEqual(expect.objectContaining({ what: 'uncommitted', count: 2, note: expect.stringContaining('a.txt, dirty.txt') }));
    const res = await call('POST', `/threads/${src.id}/continue`, { ...claude, text: 'go', request_id: randomUUID(), revision: p.body.revision });
    const id = res.body.thread.id;
    await H.untilResults(id, 1);
    const t = H.thread(id);
    expect(t.cwd).toBe(join(H.paths.worktrees, id));
    expect(git(t.cwd, 'rev-parse', 'HEAD')).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(readFileSync(join(t.cwd, 'a.txt'), 'utf8')).toBe('a.txt as committed\n');
    expect(existsSync(join(t.cwd, 'dirty.txt'))).toBe(false);
    expect(git(t.cwd, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8'), 'the shared checkout').toBe('edited in the shared checkout\n');
  });
});
