// Group threads slice 4 (ADR 0020): remote agents are agents. Connecting a server makes an agent with the avatar the
// server offers, the server stays behind it, a thread can start as one and it leads talk-only in a worktree made at the
// start, a seated local member changes the files and Ben commits them, a remote agent can be seated as a member, and
// threads and agents from before convert. On a booted runner, with the fake Hermes and fake eve servers.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';
import { startFakeEve, type FakeEve } from './fake-eve.ts';
import { CALLER_HEADER as CALLER } from '../caller-header.ts';

/** A 1px square PNG, as a server offers its avatar. */
const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const OTHER_AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const T = { timeout: 30_000 };

// A stand-in for gh: `pr create` prints the new PR's URL; every call is logged.
const GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://github.com/acme/widgets/pull/42"; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi
echo "[]"
`;

let eve: FakeEve;
let hermes: FakeHermes;
let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let repo: string;
let origin: string;
let ghLog: string;

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
const mention = (agent: string, name: string) => ({ id: randomUUID().slice(0, 12), kind: 'agent_mention', v: 1, label: `@${name}`, body: { agent, name } });
const say = (threadId: string, prompt: string, ...agents: [string, string][]) => call(`/threads/${threadId}/messages`, json('POST', { prompt, context: agents.map(([a, n]) => mention(a, n)) }));
const crew = async () => (await call('/crew?all=1')).json as any[];
const sessionOf = (threadId: string, agent: string) => H.db.members.of(threadId, agent)!.session_thread;
const untilIdle = (threadId: string, results: number) =>
  H.until(`${results} results in ${threadId}`, () => {
    const busy = [threadId, ...H.db.members.all(threadId).map((m) => m.session_thread)].some((id) => ['running', 'queued'].includes(H.thread(id).status));
    return !busy && H.byKind(threadId, 'result').length >= results;
  }, 20_000);
/** What each eve session was sent: its message and the client context Omni sent as instructions. */
const eveSent = () => eve.calls.filter((c) => c.method === 'POST' && c.path === '/eve/v1/session').map((c) => c.body as { message: string; clientContext?: string });

/** Connect the fake eve agent as Nomos, the way the Add remote agent sheet does. */
async function connectNomos(slug = 'nomos', name = 'Nomos') {
  const paired = await call('/harnesses/connect/pair', json('POST', { url: eve.url, code: eve.code, name: 'Nomos', kind: 'eve' }));
  expect(paired.status).toBe(200);
  expect((await call('/harnesses/connect/test', json('POST', { draft: paired.json.draft }))).json.ok).toBe(true);
  return call('/harnesses/connect', json('POST', { slug, name, draft: paired.json.draft }));
}

beforeAll(async () => {
  eve = await startFakeEve('eve-paired-key-0123456789');
  hermes = await startFakeHermes('hermes-key-0123456789');
  const bin = mkdtempSync(join(tmpdir(), 'omni-remote-bin-'));
  ghLog = join(bin, 'gh.log');
  writeFileSync(join(bin, 'gh'), GH, { mode: 0o755 });
  H = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-remote-home-')), OMNI_SECRET_STORE: 'file', OMNI_HERMES_URL: hermes.url, FAKE_GH_LOG: ghLog });
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  ({ app } = await import('../app.ts'));
  await (await import('../secrets.ts')).setSecret('global', 'HERMES_API_KEY', hermes.token);
  // A repo channel with worktrees on, whose origin is a bare repo a push can reach.
  origin = join(H.tmp, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  repo = join(H.tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  // Who the Commit button commits as: the repo's own identity, as on Ben's machine.
  git(repo, 'config', 'user.email', 'ben@example.com');
  git(repo, 'config', 'user.name', 'Ben');
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  H.db.channels.create({ id: 'repo', name: 'Repo', kind: 'client', use_worktree: 1, repo_path: repo, github_repo: 'acme/widgets' });
  for (const [id, name] of [['lead', 'Lead'], ['builder2', 'Builder Two']]) {
    expect((await call('/crew', json('POST', { id, fields: { name, harness: 'claude-code', model: 'sonnet' }, charter: `You are ${name}.` }))).status).toBe(201);
  }
  await (await import('../harness/catalog-service.ts')).loadCatalog();
});

afterAll(async () => {
  await eve?.close();
  await hermes?.close();
});

describe('connecting makes an agent', () => {
  it('makes the agent with the avatar its server offers, with no charter, even when asked not to', T, async () => {
    eve.offer = { ...eve.offer, avatar: AVATAR };
    const found = await call('/harnesses/connect/find', json('POST', { url: eve.url }));
    expect(found.json).toMatchObject({ kind: 'eve', name: 'Nomos', avatar: AVATAR });

    const paired = await call('/harnesses/connect/pair', json('POST', { url: eve.url, code: eve.code, name: 'Nomos', kind: 'eve' }));
    await call('/harnesses/connect/test', json('POST', { draft: paired.json.draft }));
    // An older client still sends role: false. The agent is what connecting is for, so it is made anyway.
    const done = await call('/harnesses/connect', json('POST', { slug: 'nomos', name: 'Nomos', draft: paired.json.draft, role: false, description: found.json.description }));
    expect(done.status).toBe(201);
    expect(done.json.role).toEqual({ id: 'nomos', name: 'Nomos' });

    const nomos = (await crew()).find((r) => r.id === 'nomos');
    // Its description is the one the server offered, as Find showed it.
    expect(nomos).toMatchObject({ name: 'Nomos', description: 'An eve agent for tests.', harness: 'custom:nomos', charter: '', server: { harness: 'custom:nomos', kind: 'eve', builtIn: false, available: true, secret: 'AGENT_NOMOS_KEY' } });
    const image = await app.request(nomos.avatar.image);
    expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(AVATAR.split(',')[1]);
  });
});

describe('remote agents leave the pickers', () => {
  it('never runs a local agent on a remote server, and leads a thread asked for on one with its agent', T, async () => {
    const put = await call('/crew/lead', json('PUT', { fields: { harness: 'custom:nomos', model: 'default' } }));
    expect(put.status).toBe(400);
    expect(put.json.error).toMatch(/local agent does not run on a remote agent's server/);
    expect((await call('/crew/nomos', json('PUT', { fields: { harness: 'claude-code', model: 'sonnet' } }))).json.error).toMatch(/Nomos is a remote agent/);
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'x', role: 'lead', harness: 'custom:nomos' })).rejects.toThrow(/local agent no longer runs on a remote agent's server/);
    // An older client asks for the server itself: the thread is led by its agent.
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'hello', harness: 'custom:nomos', model: 'default' });
    expect([t.role, t.harness]).toEqual(['nomos', 'custom:nomos']);
    await H.untilResults(t.id, 1);
    // Auto never picks a remote agent (Q33), nor does a channel default left on one.
    H.db.channels.update('scratch', { default_harness: 'custom:nomos', default_model: 'default' });
    const auto = await H.runner.createThread({ channel: 'scratch', prompt: 'what is 2 + 2' });
    H.db.channels.update('scratch', { default_harness: null, default_model: null });
    expect(auto.harness).toBe('claude-code');
    expect(auto.role).toBeNull();
    await H.untilResults(auto.id, 1);
  });
});

describe('a thread led by a remote agent', () => {
  let lead: { id: string };

  it('starts in its own worktree and answers without changing files, with the thread framing and no charter', T, async () => {
    eve.reset();
    const t = await H.runner.createThread({ channel: 'repo', prompt: 'what is left on the release?', role: 'nomos' });
    lead = t;
    await H.untilResults(t.id, 1);
    const row = H.thread(t.id);
    // The worktree is made at the start (Q31), so a local member needs no setup run later.
    expect(row.branch).toBe(`omni/${t.id.slice(0, 8)}`);
    expect(row.cwd).toBe(join(H.paths.worktrees, t.id));
    expect(existsSync(join(row.cwd, 'README.md'))).toBe(true);
    expect(git(row.cwd, 'status', '--porcelain')).toBe('');
    expect(H.texts(t.id, 'assistant_text').join('')).toContain('You have two reminders.');

    const [sent] = eveSent();
    expect(sent.message).toBe('what is left on the release?');
    // Omni's thread framing, which says it talks only, and no charter of Omni's: the server's own instructions lead (Q28).
    expect(sent.clientContext).toContain('# Omni OS context');
    expect(sent.clientContext).toContain('You are Nomos');
    expect(sent.clientContext).toMatch(/You talk only in this thread/);
    expect(sent.clientContext).not.toContain('## Your agent');
  });

  it('sends a charter as instructions only when Ben wrote one in its file', T, async () => {
    expect((await call('/crew/nomos', json('PUT', { charter: 'Answer in one line.' }))).status).toBe(200);
    eve.reset();
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'and now?', role: 'nomos' });
    await H.untilResults(t.id, 1);
    expect(eveSent()[0].clientContext).toContain('## Your agent: Nomos\nAnswer in one line.');
    expect((await call('/crew/nomos', json('PUT', { charter: '' }))).status).toBe(200);
  });

  it('seats a local member, which changes the files, and Ben commits them', T, async () => {
    const res = await say(lead.id, 'WRITE:notes.md add the notes', ['builder2', 'Builder Two']);
    expect(res.status).toBe(200);
    await untilIdle(lead.id, 2);
    const cwd = H.thread(lead.id).cwd!;
    // The member ran in the thread's worktree with no setup run of its own.
    expect(H.thread(sessionOf(lead.id, 'builder2')).cwd).toBe(cwd);
    expect(readFileSync(join(cwd, 'notes.md'), 'utf8')).toBe('written by fake-claude');
    // Its prompt says Ben commits, since the remote lead talks only, and keeps git commit and pull requests away from it.
    const { buildSystemPrompt } = await import('../runner/prompts.ts');
    const { getCrew } = await import('../crew.ts');
    const member = H.thread(sessionOf(lead.id, 'builder2'));
    const prompt = buildSystemPrompt(member, H.db.channels.get('repo')!, getCrew('builder2')!);
    expect(prompt).toMatch(/Edit files only\. Nomos is a remote agent and talks only, so .+ commits and opens the pull request: never run git commit/);

    // A collision flag raised before the commit (two members changed one file) comes down with it, as an agent's does.
    const before = git(cwd, 'rev-parse', 'HEAD');
    H.db.events.add(lead.id, 'collision', { key: 'k-notes', path: 'notes.md', agents: ['builder2', 'designer'], head: before });
    const { collisionsOf } = await import('../runner/collisions.ts');
    expect(collisionsOf(lead.id)).toHaveLength(1);

    // Only Ben commits: an agent thread is refused.
    const agent = await call(`/threads/${lead.id}/commit`, json('POST', { message: 'Add the notes' }, { [CALLER]: lead.id }));
    expect(agent.status).toBe(403);
    const done = await call(`/threads/${lead.id}/commit`, json('POST', { message: 'Add the notes' }));
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ sha: expect.stringMatching(/^[0-9a-f]{40}$/), files: 1 });
    expect(git(cwd, 'log', '-1', '--format=%s')).toBe('Add the notes');
    expect(git(cwd, 'status', '--porcelain')).toBe('');
    expect(H.byKind(lead.id, 'member').map((e) => e.p.event)).toContain('committed');
    expect(collisionsOf(lead.id)).toEqual([]);
    expect(H.byKind(lead.id, 'collision_cleared').map((e) => e.p)).toEqual([{ keys: ['k-notes'], by: 'commit' }]);
    // Nothing left to commit.
    expect((await call(`/threads/${lead.id}/commit`, json('POST', { message: 'again' }))).status).toBe(409);
  });

  it('opens the pull request through the thread’s Open PR action', T, async () => {
    const res = await call(`/threads/${lead.id}/open-pr`, json('POST', {}));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ url: 'https://github.com/acme/widgets/pull/42' });
    const branch = H.thread(lead.id).branch!;
    expect(git(origin, 'rev-parse', branch)).toBe(git(H.thread(lead.id).cwd!, 'rev-parse', 'HEAD'));
    const created = readFileSync(ghLog, 'utf8').split('\n').find((l) => l.startsWith('pr create'));
    expect(created).toContain(`--head ${branch}`);
  });
});

describe("a remote agent's server card", () => {
  it('goes with its server: Delete is refused while the server is there', T, async () => {
    const del = await call('/crew/nomos', { method: 'DELETE' });
    expect(del.status).toBe(409);
    expect(del.json.error).toMatch(/Remove Nomos on its Server card/);
    expect((await crew()).some((r) => r.id === 'nomos')).toBe(true);
  });

  it('reads the offered avatar again on Test connection, unless Ben set one of his own', T, async () => {
    const image = async () => {
      const r = (await crew()).find((x) => x.id === 'nomos');
      return Buffer.from(await (await app.request(r.avatar.image)).arrayBuffer()).toString('base64');
    };
    eve.offer = { ...eve.offer, avatar: OTHER_AVATAR };
    const test = await call('/crew/nomos/server/test', json('POST', {}));
    expect(test.json).toMatchObject({ ok: true });
    expect(await image()).toBe(OTHER_AVATAR.split(',')[1]);
    // The page says the image is the one its server offered.
    expect((await crew()).find((r) => r.id === 'nomos').server).toMatchObject({ avatarOffered: true });
    // Ben's own upload stays through the next offer.
    expect((await call('/crew/nomos/avatar', json('PUT', { image: AVATAR }))).status).toBe(200);
    eve.offer = { ...eve.offer, avatar: OTHER_AVATAR };
    await call('/crew/nomos/server/test', json('POST', {}));
    expect(await image()).toBe(AVATAR.split(',')[1]);
    expect((await crew()).find((r) => r.id === 'nomos').server.avatarOffered).toBeUndefined();
    // Only Ben tests or removes a server.
    expect((await call('/crew/nomos/server/test', json('POST', {}, { [CALLER]: randomUUID() }))).status).toBe(403);
  });

  it('makes Hermes the remote agent hermes, with its Settings address and key as its server', T, async () => {
    const { convertRemoteAgents } = await import('../remote-agents.ts');
    expect(convertRemoteAgents().agents).toContain('hermes');
    const agent = (await crew()).find((r) => r.id === 'hermes');
    expect(agent).toMatchObject({ name: 'Hermes', harness: 'hermes', server: { harness: 'hermes', builtIn: true, kind: 'runs-api', url: hermes.url, secret: 'HERMES_API_KEY' } });
    hermes.avatar = AVATAR;
    const test = await call('/crew/hermes/server/test', json('POST', {}));
    expect(test.json).toMatchObject({ ok: true });
    expect((await crew()).find((r) => r.id === 'hermes').avatar.image).toMatch(/^\/api\/crew\/hermes\/avatar/);
    // Its threads run on Hermes, led by it.
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'hi Hermes', role: 'hermes' });
    expect(t.harness).toBe('hermes');
    await H.untilResults(t.id, 1);
  });
});

describe('a remote agent seated as a member', () => {
  it('reads the thread as message text, or only the message to it in a channel closed to remote agents', T, async () => {
    for (const closed of [false, true]) {
      H.db.channels.update('scratch', { remote_work: closed ? 0 : 1 });
      const t = await H.runner.createThread({ channel: 'scratch', prompt: 'RICH plan the release', role: 'lead' });
      await H.untilResults(t.id, 1);
      eve.reset();
      expect((await say(t.id, 'what do you make of it?', ['nomos', 'Nomos'])).status).toBe(200);
      await untilIdle(t.id, 2);
      const [sent] = eveSent();
      // Its prompt seats it as a remote agent that talks only, not as a harness on a branch of its own.
      expect(sent.clientContext).toContain('## Group thread');
      expect(sent.clientContext).toMatch(/You talk only: the local agents seated here change the files/);
      expect(sent.clientContext).not.toMatch(/branch of your own/);
      if (closed) expect(sent.message).toMatch(/^what do you make of it\?\n\n<omni-context>/);
      else expect(sent.message).toMatch(/^\[Catch-up\] You are Nomos, a remote agent seated in this thread\. Lead leads it\. You talk only[^]*\n---\n\nwhat do you make of it\?/);
      // Its reply lands in the group thread as Nomos.
      expect(H.db.events.since(t.id).filter((r) => r.kind === 'assistant_text').map((r) => r.agent)).toContain('nomos');
    }
    H.db.channels.update('scratch', { remote_work: 0 });
  });
});

describe('converting what came before', () => {
  it('leads old threads with their server’s agent, gives a server with no agent one, and keeps a bound agent', T, async () => {
    const { convertRemoteAgents } = await import('../remote-agents.ts');
    // A server connected with Make an agent for it unticked, and Builder Two bound to it by its file.
    const old = await connectNomos('nomos-old', 'Nomos Old');
    expect(old.status).toBe(201);
    const { deleteCrew, saveCrew } = await import('../crew-store.ts');
    deleteCrew('nomos-old');
    const ctx = { catalog: (await import('../harness/catalog-service.ts')).getCatalog(), channelExists: () => true };
    saveCrew('helper', { fields: { name: 'Helper', harness: 'custom:nomos-old', model: 'default', avatar: { bg: '#f5e6ba' } } }, ctx, { create: true });
    const threadOn = (harness: string, role: string | null) => {
      const id = randomUUID();
      H.db.threads.create({ id, channel_id: 'scratch', title: 'old', status: 'done', role, model: 'default', harness, effort: '', auto_reason: null, session_id: id, cwd: join(H.paths.threads, id), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, owner: null });
      return id;
    };
    const onHermes = threadOn('hermes', null);
    const builderOnHermes = threadOn('hermes', 'lead');
    const onHelper = threadOn('custom:nomos-old', 'helper');
    const onNomos = threadOn('custom:nomos', null);

    const out = convertRemoteAgents();
    expect(out.agents).toEqual([]);
    expect(H.thread(onHermes).role).toBe('hermes');
    expect(H.thread(builderOnHermes).role).toBe('hermes');
    expect(H.thread(onNomos).role).toBe('nomos');
    // The agent bound to it is that server's remote agent, with its own name and avatar (Q65).
    expect(H.thread(onHelper).role).toBe('helper');
    expect((await crew()).find((r) => r.id === 'helper')).toMatchObject({ name: 'Helper', avatar: { bg: '#f5e6ba' }, server: { harness: 'custom:nomos-old' } });
    // Again: nothing more changes.
    expect(convertRemoteAgents()).toEqual({ agents: [], threads: 0 });

    // A server with no agent at all gets one with its name.
    deleteCrew('helper');
    const made = convertRemoteAgents();
    expect(made.agents).toEqual(['nomos-old']);
    expect((await crew()).find((r) => r.id === 'nomos-old')).toMatchObject({ harness: 'custom:nomos-old', server: { kind: 'eve' } });
    expect(H.thread(onHelper).role).toBe('nomos-old');

    // A converted thread stays usable: it takes a message and its agent answers.
    eve.reset();
    expect((await call(`/threads/${onNomos}/messages`, json('POST', { prompt: 'still there?' }))).status).toBe(200);
    await H.untilResults(onNomos, 1);
    expect(eveSent().at(-1)?.message).toBe('still there?');
  });
});
