import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '@omni/test-fixtures';
import { artifactKey, type ClaudeArtifactsResponse } from '@omni/shared/claude-artifacts.ts';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The claude.ai Artifacts listing (apps/server/claude-artifacts.ts): the guard hook, a run read off the stream for
// every failure code, the cache keeping the last good list, the daily type pass, and /api/claude-artifacts. The fake
// CLI answers the Artifact calls from packages/test-fixtures/claude-artifacts and runs the real guard from --settings.

let db: typeof import('../db.ts');
let mod: typeof import('../claude-artifacts.ts');
let api: typeof import('../claude-artifacts-api.ts').claudeArtifactsApi;
let bus: typeof import('../bus.ts').bus;
let dataDir: string;

const expected = JSON.parse(readFileSync(fixture('claude-artifacts', 'expected.json'), 'utf8')) as { keys: Record<string, string>; urls: Record<string, string> };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'omni-claude-artifacts-'));
  process.env.OMNI_DATA_DIR = dataDir;
  process.env.OMNI_CLAUDE_BIN = fixture('fake-claude.mjs');
  process.env.FAKE_CLAUDE_LATENCY_MS = '1';
  db = await import('../db.ts');
  mod = await import('../claude-artifacts.ts');
  ({ claudeArtifactsApi: api } = await import('../claude-artifacts-api.ts'));
  ({ bus } = await import('../bus.ts'));
});

const reset = () => {
  db.db.exec('DELETE FROM claude_artifacts; DELETE FROM claude_artifacts_meta;');
  delete process.env.FAKE_CLAUDE_ARTIFACTS;
  delete process.env.FAKE_CLAUDE_ARTIFACTS_LIST;
};
beforeEach(reset);
afterEach(reset);

const run = (mode?: string) => {
  if (mode) process.env.FAKE_CLAUDE_ARTIFACTS = mode;
  return mod.refreshClaudeArtifacts({ force: true });
};
const titles = () => db.claudeArtifacts.list().map((a) => a.title);

describe('the guard hook', () => {
  const guard = (call: unknown) => {
    const file = join(mkdtempSync(join(tmpdir(), 'omni-guard-')), 'guard.cjs');
    writeFileSync(file, mod.GUARD_SCRIPT);
    try {
      execFileSync(process.execPath, [file], { input: JSON.stringify(call), stdio: ['pipe', 'ignore', 'pipe'] });
      return { code: 0, stderr: '' };
    } catch (err) {
      const e = err as { status: number; stderr: Buffer };
      return { code: e.status, stderr: String(e.stderr) };
    }
  };

  it('lets an Artifact list through', () => {
    expect(guard({ tool_name: 'Artifact', tool_input: { action: 'list', scope: 'all', limit: 200 } }).code).toBe(0);
    expect(guard({ tool_name: 'Artifact', tool_input: { action: 'list', type: 'Slides' } }).code).toBe(0);
  });

  it.each([
    ['a publish (no action)', { tool_name: 'Artifact', tool_input: { file_path: '/tmp/x.html' } }],
    ['a delete', { tool_name: 'Artifact', tool_input: { action: 'delete', url: 'https://claude.ai/artifact/x' } }],
    ['a read', { tool_name: 'Artifact', tool_input: { action: 'read', url: 'https://claude.ai/artifact/x' } }],
    ['a list of one artifact', { tool_name: 'Artifact', tool_input: { action: 'list', scope: 'files', url: 'https://claude.ai/artifact/x' } }],
    ['an asset upload', { tool_name: 'Artifact', tool_input: { action: 'list', asset: true } }],
    ['another tool', { tool_name: 'ArtifactData', tool_input: { action: 'list' } }],
    ['Bash', { tool_name: 'Bash', tool_input: { command: 'rm -rf ~' } }],
    ['garbage', 'not json'],
  ])('blocks %s with exit 2', (_, call) => {
    const r = guard(call);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/only lists artifacts/);
  });

  it('is written once and run with this Node from --settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-guard-'));
    const settings = JSON.parse(mod.guardSettings(dir)) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
    expect(settings.hooks.PreToolUse[0].matcher).toBe('*');
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain(process.execPath);
    expect(readFileSync(join(dir, 'claude-artifacts-guard.cjs'), 'utf8')).toBe(mod.GUARD_SCRIPT);
  });

  it('runs the CLI in a private folder of its own, never a shared temp dir with planted settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-guard-'));
    const cwd = mod.listingDir(dir);
    expect(cwd).toBe(join(dir, 'claude-artifacts-run'));
    expect(statSync(cwd).mode & 0o777).toBe(0o700);
    chmodSync(cwd, 0o755);
    expect(statSync(mod.listingDir(dir)).mode & 0o777).toBe(0o700);
  });
});

describe('a refresh', () => {
  it('lists every page in the tool order, maps types on the first run, and records the run', async () => {
    const state = await run();
    expect(state.error).toBeNull();
    expect(state.total).toBe(6);
    expect(state.complete).toBe(true);
    expect(state.cli_version).toBe('2.1.278');
    expect(state.types_at).toBe(state.last_success_at);
    const items = db.claudeArtifacts.list();
    expect(items.map((a) => a.title)).toEqual(Object.keys(expected.keys));
    expect(items.map((a) => a.id)).toEqual(Object.values(expected.keys));
    const type = Object.fromEntries(items.map((a) => [a.title, a.type]));
    expect(type['Quarterly roadmap deck']).toBe('slides');
    expect(type['Shipping rates dashboard']).toBe('dashboard');
    expect(type['Team design system']).toBe('design-system');
    expect(type['Checkout audit — desktop and phone']).toBe('page');
    expect(items[0].updated_on).toBe('2026-11-08');
    expect(items[4]).toMatchObject({ scope: 'shared', updated_on: null });
  });

  it('skips the type pass within a day, and keeps the types it had', async () => {
    await run();
    const typesAt = db.claudeArtifacts.state().types_at;
    expect(mod.listingPrompt(false)).not.toContain('scope "types"');
    await run();
    expect(db.claudeArtifacts.state().types_at).toBe(typesAt);
    expect(db.claudeArtifacts.list().find((a) => a.title === 'Quarterly roadmap deck')?.type).toBe('slides');
  });

  it('runs the type pass again after a day', async () => {
    await run();
    db.claudeArtifacts.setState({ types_at: '2026-01-01T00:00:00.000Z' });
    const state = await run();
    expect(state.types_at).toBe(state.last_success_at);
  });

  it('does not map types when the run skipped a type, so nothing is wrongly a plain page', async () => {
    await run('skip_type');
    expect(db.claudeArtifacts.state().types_at).toBeNull();
    expect(db.claudeArtifacts.list().every((a) => a.type === null)).toBe(true);
  });

  it('hides a page a complete listing no longer has', async () => {
    await run();
    const fewer = join(dataDir, 'fewer.txt');
    const text = readFileSync(fixture('claude-artifacts', 'list-all.txt'), 'utf8')
      .replace('6 artifacts', '5 artifacts')
      .split('\n')
      .filter((l) => !l.includes('Team design system'))
      .join('\n');
    writeFileSync(fewer, text);
    process.env.FAKE_CLAUDE_ARTIFACTS_LIST = fewer;
    await run();
    expect(titles()).not.toContain('Team design system');
    expect(titles()).toHaveLength(5);
  });

  it('hides nothing when the listing stops short of the total', async () => {
    await run();
    process.env.FAKE_CLAUDE_ARTIFACTS_LIST = fixture('claude-artifacts', 'list-page.txt');
    const state = await run();
    expect(state.complete).toBe(false);
    expect(titles()).toHaveLength(6);
  });

  it.each([
    ['signed_out', 'signed_out'],
    ['no_tool', 'tool_unavailable'],
    ['limit', 'limit'],
    ['changed', 'format_changed'],
    ['error', 'failed'],
  ])('keeps the last good list when the CLI is %s (%s), and records the failure', async (mode, code) => {
    await run();
    const before = db.claudeArtifacts.list();
    const good = db.claudeArtifacts.state().last_success_at;
    const failures = (db.db.prepare("SELECT COUNT(*) AS n FROM tool_failures WHERE tool = 'Artifact'").get() as { n: number }).n;
    const state = await run(mode);
    expect(state.error?.code).toBe(code);
    expect(state.last_success_at).toBe(good);
    expect(db.claudeArtifacts.list()).toEqual(before);
    const row = db.db.prepare("SELECT thread_id, category, detail FROM tool_failures WHERE tool = 'Artifact' ORDER BY created_at DESC LIMIT 1").get() as { thread_id: string; detail: string };
    expect((db.db.prepare("SELECT COUNT(*) AS n FROM tool_failures WHERE tool = 'Artifact'").get() as { n: number }).n).toBe(failures + 1);
    expect(row.thread_id).toBe('claude-artifacts');
  });

  it('clears the error on the next good run', async () => {
    await run('signed_out');
    expect(db.claudeArtifacts.state().error?.code).toBe('signed_out');
    delete process.env.FAKE_CLAUDE_ARTIFACTS;
    expect((await run()).error).toBeNull();
  });

  it('says cli_missing when the claude binary is not there, and timeout when the run never ends', () => {
    const blank: import('../claude-artifacts.ts').RunOutput = { tools: null, version: null, session: null, results: [], signedOut: false, limited: false, result: null, exitCode: null, spawnError: null, timedOut: false };
    expect(mod.readRun({ ...blank, spawnError: 'ENOENT' }, false)).toMatchObject({ ok: false, code: 'cli_missing' });
    expect(mod.readRun({ ...blank, timedOut: true }, false)).toMatchObject({ ok: false, code: 'timeout' });
    expect(mod.readRun({ ...blank, exitCode: 1 }, false)).toMatchObject({ ok: false, code: 'failed' });
  });

  it('blocks a delete a hostile title could ask for, and still lists', async () => {
    const state = await run('sneaky');
    expect(state.error).toBeNull();
    expect(titles()).toHaveLength(6);
  });

  it('runs once for callers that ask at the same time, and announces start and end on the feed', async () => {
    const seen: { type: string; state: { refreshing: boolean } }[] = [];
    const on = (e: { type: string; state: { refreshing: boolean } }) => e.type === 'claude_artifacts' && seen.push(e);
    bus.on('feed', on);
    const a = mod.refreshClaudeArtifacts({ force: true });
    const b = mod.refreshClaudeArtifacts({ force: true });
    expect(a).toBe(b);
    await a;
    bus.off('feed', on);
    expect(seen.map((e) => e.state.refreshing)).toEqual([true, false]);
  });

  it('opening the screen within ten minutes of the last attempt costs no run', async () => {
    await run();
    const attempt = db.claudeArtifacts.state().last_attempt_at;
    await mod.refreshClaudeArtifacts({});
    expect(db.claudeArtifacts.state().last_attempt_at).toBe(attempt);
    await mod.refreshClaudeArtifacts({ now: () => Date.now() + 11 * 60_000 });
    expect(db.claudeArtifacts.state().last_attempt_at).not.toBe(attempt);
  });
});

describe('the schedule', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const h = 3600_000;
  it('is due once its interval has passed since the last good list', () => {
    expect(mod.scheduleDue({ schedule: 'daily', last_success_at: null, last_attempt_at: null }, now)).toBe(true);
    expect(mod.scheduleDue({ schedule: 'daily', last_success_at: new Date(now - 23 * h).toISOString(), last_attempt_at: null }, now)).toBe(false);
    expect(mod.scheduleDue({ schedule: 'daily', last_success_at: new Date(now - 25 * h).toISOString(), last_attempt_at: null }, now)).toBe(true);
    expect(mod.scheduleDue({ schedule: '6h', last_success_at: new Date(now - 7 * h).toISOString(), last_attempt_at: null }, now)).toBe(true);
    expect(mod.scheduleDue({ schedule: 'off', last_success_at: null, last_attempt_at: null }, now)).toBe(false);
  });

  it('waits 30 minutes after any attempt, so a failing CLI is not retried every hour on the dot', () => {
    expect(mod.scheduleDue({ schedule: 'daily', last_success_at: null, last_attempt_at: new Date(now - 10 * 60_000).toISOString() }, now)).toBe(false);
  });
});

describe('/api/claude-artifacts', () => {
  it('lists the cache with its state, joined to the file a thread published as each page in either link form', async () => {
    await run();
    db.channels.create({ id: 'ch-art', name: 'Art', kind: 'internal' });
    db.threads.create({ id: 't-art', channel_id: 'ch-art', title: 'Made the deck', status: 'done', role: null, model: null, session_id: 't-art', cwd: '/tmp', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null });
    const file = join(dataDir, 'deck.html');
    writeFileSync(file, '<p>deck</p>');
    const row = db.artifacts.upsert({ thread_id: 't-art', path: file, name: 'deck.html', kind: 'html', size: 11 });
    // An older publish named the page by its uuid.
    db.artifacts.setPublished(row.id, `https://claude.ai/code/artifact/${expected.keys['Quarterly roadmap deck']}`, null);
    const res = await api.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaudeArtifactsResponse;
    expect(body.state).toMatchObject({ schedule: 'daily', refreshing: false, total: 6 });
    const deck = body.items.find((a) => a.title === 'Quarterly roadmap deck')!;
    expect(artifactKey(deck.url)).toBe(deck.id);
    expect(deck.local).toEqual({
      artifact_id: row.id,
      thread_id: 't-art',
      thread_title: 'Made the deck',
      channel_id: 'ch-art',
      // The grid previews the local file, so it needs the file's kind and version.
      kind: 'html',
      updated_at: db.artifacts.get(row.id)!.updated_at,
    });
    expect(body.items.find((a) => a.title === 'Team design system')?.local).toBeNull();
  });

  it('refreshes in the background, or waits when asked', async () => {
    const started = await api.request('/refresh', { method: 'POST', body: JSON.stringify({ force: true }), headers: { 'content-type': 'application/json' } });
    expect(started.status).toBe(202);
    expect(((await started.json()) as { state: { refreshing: boolean } }).state.refreshing).toBe(true);
    const waited = await api.request('/refresh', { method: 'POST', body: JSON.stringify({ force: true, wait: true }), headers: { 'content-type': 'application/json' } });
    expect(waited.status).toBe(200);
    expect(((await waited.json()) as ClaudeArtifactsResponse).items).toHaveLength(6);
  });

  it('sets the schedule, and refuses one it does not know', async () => {
    const ok = await api.request('/schedule', { method: 'PUT', body: JSON.stringify({ schedule: '6h' }), headers: { 'content-type': 'application/json' } });
    expect(((await ok.json()) as { state: { schedule: string } }).state.schedule).toBe('6h');
    expect(db.claudeArtifacts.schedule()).toBe('6h');
    const bad = await api.request('/schedule', { method: 'PUT', body: JSON.stringify({ schedule: 'hourly' }), headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
  });
});
