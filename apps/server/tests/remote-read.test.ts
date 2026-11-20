// Group threads slice 5 (ADR 0020, #903): a remote agent reads the thread's worktree where the channel's switch,
// Remote agents can see this channel's work, allows it. The read tool lists, reads and searches the thread's git-tracked
// files and returns its diff, through a per-turn credential that never leaves Omni, carried through the protocol as a
// client-side tool call. On a booted runner, with the fake Hermes and fake eve servers.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';
import { startFakeEve, type FakeEve } from './fake-eve.ts';
import { CALLER_HEADER as CALLER } from '../caller-header.ts';

const T = { timeout: 30_000 };

let eve: FakeEve;
let hermes: FakeHermes;
let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let repo: string;
let outside: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();
const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({ method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const call = async (path: string, init?: RequestInit) => {
  const res = await app.request(`/api${path}`, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, json: body };
};
const setSwitch = (on: boolean) => call('/channels/repo', json('PATCH', { remote_work: on ? 1 : 0 }));
const READ_ROWS = new Set(['Read', 'Glob', 'Grep', 'Diff', 'omni_worktree']);
/** The read rows a thread shows: each call's tool row and what came back. */
const readRows = (threadId: string) => {
  const results = new Map(H.byKind(threadId, 'tool_result').map((e) => [e.p.tool_use_id ?? e.p.id, e.p]));
  return H.byKind(threadId, 'tool_use').filter((e) => READ_ROWS.has(e.p.name)).map((e) => ({ name: e.p.name as string, input: e.p.input, result: results.get(e.p.id) as { text?: string; content?: string; is_error?: boolean } | undefined }));
};

/** A thread in the repo channel led by Hermes, its first turn done, with untracked and ignored files in its worktree. */
async function hermesThread() {
  const t = await H.runner.createThread({ channel: 'repo', prompt: 'hello', role: 'hermes' });
  await H.untilResults(t.id, 1);
  const cwd = H.thread(t.id).cwd!;
  writeFileSync(join(cwd, 'notes.txt'), 'untracked notes\n');
  writeFileSync(join(cwd, 'secret.env'), 'TOKEN=ignored\n');
  return { id: t.id, cwd };
}

/** Ask the thread's next turn for these reads. */
async function askReads(threadId: string, results: number, ...reads: unknown[]) {
  hermes.reads = reads.map((a) => ({ arguments: a }));
  expect((await call(`/threads/${threadId}/messages`, json('POST', { prompt: 'read it' }))).status).toBe(200);
  await H.untilResults(threadId, results);
}

/** A thread in the repo channel led by Hermes, whose turn asks for these reads. */
async function hermesReads(...reads: unknown[]) {
  hermes.reads = reads.map((a) => ({ arguments: a }));
  const t = await H.runner.createThread({ channel: 'repo', prompt: 'look at the work', role: 'hermes' });
  await H.untilResults(t.id, 1);
  return t;
}

beforeAll(async () => {
  eve = await startFakeEve('eve-paired-key-0123456789');
  hermes = await startFakeHermes('hermes-key-0123456789');
  H = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-read-home-')), OMNI_SECRET_STORE: 'file', OMNI_HERMES_URL: hermes.url });
  ({ app } = await import('../app.ts'));
  await (await import('../secrets.ts')).setSecret('global', 'HERMES_API_KEY', hermes.token);
  repo = join(H.tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, '.gitignore'), 'secret.env\n');
  // A tracked binary, a tracked 3 MB text file, and tracked symlinks: one out of the worktree, one to a tracked file in it.
  writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]));
  writeFileSync(join(repo, 'big.txt'), 'abcdefghi\n'.repeat(300_000));
  outside = join(H.tmp, 'outside.txt');
  writeFileSync(outside, 'a secret outside the worktree\n');
  symlinkSync(outside, join(repo, 'out-link'));
  symlinkSync('a.ts', join(repo, 'src', 'a-link.ts'));
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  H.db.channels.create({ id: 'repo', name: 'Repo', kind: 'client', use_worktree: 1, repo_path: repo });
  (await import('../remote-agents.ts')).convertRemoteAgents();
  await (await import('../harness/catalog-service.ts')).loadCatalog();
  // Nomos, an eve agent, connected the way the Add remote agent sheet does it.
  const paired = await call('/harnesses/connect/pair', json('POST', { url: eve.url, code: eve.code, name: 'Nomos', kind: 'eve' }));
  expect((await call('/harnesses/connect/test', json('POST', { draft: paired.json.draft }))).json.ok).toBe(true);
  expect((await call('/harnesses/connect', json('POST', { slug: 'nomos', name: 'Nomos', draft: paired.json.draft }))).status).toBe(201);
});

afterAll(async () => {
  await eve?.close();
  await hermes?.close();
});

const hermesHolds = () => hermes.toolResults;

beforeEach(() => {
  hermes.reset();
  eve.reset();
});

describe("the switch: Remote agents can see this channel's work", () => {
  it('starts off in a new channel, and only Ben sets it: an agent thread gets a 403', T, async () => {
    expect((await call('/channels', json('POST', { id: 'fresh', name: 'Fresh' }))).status).toBe(200);
    expect((await call('/channels/fresh')).json.remote_work).toBe(0);
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'hello' });
    await H.untilResults(t.id, 1);
    for (const v of [1, 0]) {
      const agent = await call('/channels/fresh', json('PATCH', { remote_work: v }, { [CALLER]: t.id }));
      expect(agent.status).toBe(403);
      expect(agent.json.error).toMatch(/Agents cannot change whether remote agents can see this channel's work/);
    }
    expect((await call('/channels', json('POST', { id: 'fresh-2', name: 'Fresh 2', remote_work: 1 }, { [CALLER]: t.id }))).status).toBe(403);
    expect((await call('/channels/fresh', json('PATCH', { remote_work: 1 }))).json.remote_work).toBe(1);
    expect((await call('/channels/fresh')).json.remote_work).toBe(1);
  });

  it('turns on, at the upgrade, only in channels where an Ask sent a remote agent an excerpt', T, async () => {
    const { db, migrate } = await import('../db.ts');
    const made = (id: string) => H.db.channels.create({ id, name: id, kind: 'client', use_worktree: 0, base_dir: H.tmp });
    const thread = (channel: string) => H.runner.createThread({ channel, prompt: 'hi' });
    const ask = (threadId: string, p: Record<string, unknown>) => H.db.events.add(threadId, 'ask', { thread_id: 'child', role: 'r', name: 'R', harness: 'hermes', harness_name: 'Hermes', question: 'q', wake: false, title: 'Ask: q', channel: 'x', ...p });
    for (const id of ['sent', 'local', 'bare', 'closed', 'quiet']) made(id);
    const sent = await thread('sent');
    ask(sent.id, { remote: true, excerpt: { entries: 3, total: 3, chars: 120 } });
    // An Ask to a local agent with an excerpt, and one to a remote agent that carried none.
    ask((await thread('local')).id, { remote: false, excerpt: { entries: 3, total: 3, chars: 120 } });
    ask((await thread('bare')).id, { remote: true, excerpt: null });
    // One that sent an excerpt before Ben closed the channel with the old switch.
    ask((await thread('closed')).id, { remote: true, excerpt: { entries: 1, total: 1, chars: 10 } });
    // A database from before this switch: the old column set, the new one not there yet.
    db.exec(`UPDATE channels SET remote_excerpts_off = 1 WHERE id = 'closed'`);
    db.exec('ALTER TABLE channels DROP COLUMN remote_work');
    migrate();
    const on = (await call('/channels')).json.filter((c: any) => c.remote_work === 1).map((c: any) => c.id);
    expect(on).toEqual(['sent']);
    // Running again changes nothing, and Ben's own choice stays.
    expect((await call('/channels/sent', json('PATCH', { remote_work: 0 }))).json.remote_work).toBe(0);
    migrate();
    expect((await call('/channels/sent')).json.remote_work).toBe(0);
  });
});

describe('a remote agent reads the worktree where the channel allows it', () => {
  it('reads src/a.ts, as a tool row in the thread', T, async () => {
    expect((await setSwitch(true)).status).toBe(200);
    const t = await hermesReads({ action: 'read', path: 'src/a.ts' });
    expect(hermes.toolResults).toEqual([expect.objectContaining({ is_error: false, output: expect.stringContaining('export const a = 1;') })]);
    expect(readRows(t.id)).toEqual([expect.objectContaining({ name: 'Read', input: expect.objectContaining({ file_path: 'src/a.ts' }) })]);
    expect(H.texts(t.id, 'assistant_text').join('')).toContain('Read 1 times.');
    // The run offered the tool as a client-side call, and the grant itself never left Omni.
    const run = hermes.calls.find((c) => c.method === 'POST' && c.path === '/v1/runs')!;
    expect((run.body as any).tools).toEqual([expect.objectContaining({ name: 'omni_worktree', parameters: expect.objectContaining({ type: 'object' }) })]);
    expect(JSON.stringify(hermes.calls)).not.toMatch(/omr_/);
  });

  it('is refused with the switch off, and the thread says why', T, async () => {
    expect((await setSwitch(false)).status).toBe(200);
    const t = await hermesReads({ action: 'read', path: 'src/a.ts' });
    const run = hermes.calls.find((c) => c.method === 'POST' && c.path === '/v1/runs')!;
    expect((run.body as any).tools).toBeUndefined();
    expect(hermes.toolResults).toEqual([expect.objectContaining({ is_error: true, output: expect.stringMatching(/#Repo keeps its work from remote agents\. [A-Z].* can open it in Channel settings with "Remote agents can see this channel's work"\.$/) })]);
    const [row] = readRows(t.id);
    expect(row).toMatchObject({ name: 'Read', result: { is_error: true, text: expect.stringMatching(/keeps its work from remote agents/) } });
    expect(row.result!.text).not.toContain('export const a');
  });

  it('refuses paths outside the worktree, untracked, ignored and binary files, and symlinks out of it', T, async () => {
    expect((await setSwitch(true)).status).toBe(200);
    const t = await hermesThread();
    const asked = ['../outside.txt', outside, 'notes.txt', 'secret.env', '.git/config', 'logo.png', 'out-link', 'src'];
    await askReads(t.id, 2, ...asked.map((path) => ({ action: 'read', path })));
    const out = hermes.toolResults.map((r) => [r.is_error, r.output]);
    expect(out).toEqual([
      [true, expect.stringMatching(/^Refused: \.\.\/outside\.txt is outside the thread's worktree/)],
      [true, expect.stringMatching(/is outside the thread's worktree/)],
      [true, expect.stringMatching(/no git-tracked file at notes\.txt.+untracked and ignored files are hidden/)],
      [true, expect.stringMatching(/no git-tracked file at secret\.env/)],
      [true, expect.stringMatching(/no git-tracked file at \.git\/config/)],
      [true, expect.stringMatching(/logo\.png is a binary file/)],
      [true, expect.stringMatching(/out-link leads out of the thread's worktree/)],
      [true, expect.stringMatching(/src is a folder/)],
    ]);
    for (const [, text] of out) expect(text).not.toMatch(/untracked notes|TOKEN=ignored|a secret outside/);
    // Every refusal is a tool row in the thread that says why.
    const rows = readRows(t.id);
    expect(rows.map((r) => r.input.file_path)).toEqual(asked);
    expect(rows.every((r) => r.result?.is_error && /^Refused: /.test(r.result.text ?? ''))).toBe(true);
  });

  it('follows a symlink to a tracked file inside, and cuts a 3 MB text file to 1 MB with a note', T, async () => {
    const t = await hermesThread();
    await askReads(t.id, 2, { action: 'read', path: 'src/a-link.ts' }, { action: 'read', path: 'big.txt' });
    const [link, big] = hermesHolds();
    expect(link).toMatchObject({ is_error: false, output: 'export const a = 1;\n' });
    expect(big.is_error).toBe(false);
    expect(big.output).toMatch(/\n\n\[Cut to 1 MB of 3\.0 MB: the rest of big\.txt was left out\.\]$/);
    expect(Buffer.byteLength(big.output.split('\n\n[Cut')[0])).toBe(1_000_000);
  });

  it('lists, searches and diffs tracked files only: a new file shows once it is staged', T, async () => {
    const t = await hermesThread();
    // What a local member did in the worktree: changed a tracked file, staged a new one, left one untracked.
    writeFileSync(join(t.cwd, 'src', 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(t.cwd, 'src', 'b.ts'), 'export const b = "needle";\n');
    git(t.cwd, 'add', 'src/b.ts');
    writeFileSync(join(t.cwd, 'notes.txt'), 'needle in the untracked notes\n');
    writeFileSync(join(t.cwd, 'secret.env'), 'TOKEN=needle\n');
    await askReads(t.id, 2, { action: 'list' }, { action: 'list', path: 'src' }, { action: 'search', pattern: 'need+le' }, { action: 'diff' }, { action: 'list', path: '../' });
    const [all, src, found, diff, up] = hermes.toolResults;
    expect(all.output.split('\n').sort()).toEqual(['.gitignore', 'README.md', 'big.txt', 'logo.png', 'out-link', 'src/a-link.ts', 'src/a.ts', 'src/b.ts']);
    expect(src.output.split('\n')).toEqual(['src/a-link.ts', 'src/a.ts', 'src/b.ts']);
    expect(found.output).toBe('src/b.ts:1:export const b = "needle";');
    expect(diff.is_error).toBe(false);
    expect(diff.output).toMatch(/^Changed files since the thread's base \([0-9a-f]{10}\):\nmodified: src\/a\.ts\nadded: src\/b\.ts\n\n/);
    expect(diff.output).toContain('-export const a = 1;\n+export const a = 2;');
    expect(diff.output).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(diff.output).not.toMatch(/notes\.txt|secret\.env|TOKEN/);
    expect(up).toMatchObject({ is_error: true, output: expect.stringMatching(/outside the thread's worktree/) });
    expect(readRows(t.id).map((r) => r.name)).toEqual(['Glob', 'Glob', 'Grep', 'Diff', 'Glob']);
  });

  it('refuses a read after its turn ended: a call that names an earlier run', T, async () => {
    const t = await hermesThread();
    const first = hermes.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs').length;
    // The thread's first run is over. Its next run replays a call stamped with the first run's id.
    const ended = `run_${first}`;
    hermes.reads = [{ arguments: { action: 'read', path: 'src/a.ts' }, run_id: ended }, { arguments: { action: 'read', path: 'src/a.ts' } }];
    expect((await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'read it' }))).status).toBe(200);
    await H.untilResults(t.id, 2);
    const [late, now] = hermes.toolResults;
    expect(late).toMatchObject({ is_error: true, output: expect.stringMatching(/the turn that asked for this read has ended/) });
    expect(late.output).not.toContain('export const a');
    // The live turn's own read still works.
    expect(now).toMatchObject({ is_error: false, output: 'export const a = 1;\n' });
    expect(readRows(t.id).map((r) => r.result?.is_error)).toEqual([true, false]);
  });

  it('keeps a server that takes no client-side tools working, without the read', T, async () => {
    hermes.rejectTools = true;
    const t = await H.runner.createThread({ channel: 'repo', prompt: 'hello', role: 'hermes' });
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'result').at(-1)!.p.ok).toBe(true);
    const runs = hermes.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs');
    expect(runs.map((c) => !!(c.body as any).tools)).toEqual([true, false]);
    expect(runs[1].idempotencyKey).toMatch(/:notools$/);
    // It is not offered again in that session.
    expect((await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'again' }))).status).toBe(200);
    await H.untilResults(t.id, 2);
    expect(hermes.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs').map((c) => !!(c.body as any).tools)).toEqual([true, false, false]);
  });

  it("reads the group thread's worktree when seated as a member, under its own name", T, async () => {
    expect((await call('/crew', json('POST', { id: 'lead', fields: { name: 'Lead', harness: 'claude-code', model: 'sonnet' }, charter: 'You are Lead.' }))).status).toBe(201);
    const t = await H.runner.createThread({ channel: 'repo', prompt: 'WRITE:src/c.ts start on it', role: 'lead' });
    await H.untilResults(t.id, 1);
    git(H.thread(t.id).cwd!, 'add', 'src/c.ts');
    hermes.reads = [{ arguments: { action: 'read', path: 'src/c.ts' } }, { arguments: { action: 'diff' } }];
    const mention = { id: 'm-hermes', kind: 'agent_mention', v: 1, label: '@Hermes', body: { agent: 'hermes', name: 'Hermes' } };
    expect((await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'what do you make of it?', context: [mention] }))).status).toBe(200);
    await H.until('the member answered', () => hermes.toolResults.length === 2 && H.byKind(t.id, 'result').length >= 2, 20_000);
    const [file, diff] = hermes.toolResults;
    expect(file).toMatchObject({ is_error: false, output: 'written by fake-claude' });
    expect(diff.output).toMatch(/added: src\/c\.ts/);
    const rows = H.db.events.since(t.id).filter((r) => r.kind === 'tool_use' && ['Read', 'Diff'].includes(JSON.parse(r.payload).name));
    expect(rows.map((r) => r.agent)).toEqual(['hermes', 'hermes']);
  });
});

describe('an eve agent reads through its own tool', () => {
  const nomosReads = async (...reads: unknown[]) => {
    eve.reads = reads;
    const t = await H.runner.createThread({ channel: 'repo', prompt: 'look at the work', role: 'nomos' });
    await H.untilResults(t.id, 1);
    return t;
  };

  it('answers the input request its read parks on, and the turn goes on to its reply', T, async () => {
    expect((await setSwitch(true)).status).toBe(200);
    const t = await nomosReads({ action: 'read', path: 'src/a.ts' }, { action: 'read', path: '../outside.txt' });
    expect(eve.answers.map((a) => a.text)).toEqual(['export const a = 1;\n', expect.stringMatching(/^Refused: \.\.\/outside\.txt is outside/)]);
    expect(H.byKind(t.id, 'result').at(-1)!.p.ok).toBe(true);
    expect(H.texts(t.id, 'assistant_text').join('')).toContain('Read 2 times.');
    // One row per read, Omni's own: the agent's own tool row for the call is not drawn twice.
    expect(readRows(t.id)).toEqual([
      expect.objectContaining({ name: 'Read', result: expect.objectContaining({ is_error: false }) }),
      expect.objectContaining({ name: 'Read', result: expect.objectContaining({ is_error: true }) }),
    ]);
    expect(H.byKind(t.id, 'tool_use').map((e) => e.p.name)).toEqual(['Read', 'Read']);
  });

  it('is refused with the switch off', T, async () => {
    expect((await setSwitch(false)).status).toBe(200);
    const t = await nomosReads({ action: 'diff' });
    expect(eve.answers).toEqual([expect.objectContaining({ text: expect.stringMatching(/^Refused: #Repo keeps its work from remote agents/) })]);
    expect(readRows(t.id)).toEqual([expect.objectContaining({ name: 'Diff', result: expect.objectContaining({ is_error: true }) })]);
  });
});
