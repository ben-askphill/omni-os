import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

// A role with `tools: no-edits` (the reviewer, decision D11 in docs/plans/2026-11-18-user-defined-crew.md): each local
// harness takes its file-edit tools away and leaves it the shell, so it is not read only. Hermes and Cursor Cloud,
// where Omni cannot take a tool away, get the rule as an instruction only.
let H: Awaited<ReturnType<typeof startRunner>>;

// The user's Cursor config, so no test reads the real ~/.cursor.
const userCursor = mkdtempSync(join(tmpdir(), 'omni-cursor-config-'));
mkdirSync(join(userCursor, 'chats'));
writeFileSync(join(userCursor, 'cli-config.json'), JSON.stringify({ version: 1, permissions: { allow: [], deny: ['Read(.env)'] } }));

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR, CURSOR_CONFIG_DIR: userCursor });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

const codexStart = (id: string) => H.codexRequests().filter((q: any) => q.method === 'thread/start' && q.params?.cwd === H.thread(id).cwd).at(-1)?.params;
const cursorTurn = (id: string) => H.cursorRequests().find((r: any) => r.method === 'turn' && r.thread_id === id);

describe('the reviewer', () => {
  it('ships with no file edits, and keeps its review power', async () => {
    const { getCrew } = await import('../crew.ts');
    expect(getCrew('reviewer')).toMatchObject({ tools: 'no-edits', delegateOnly: false, review: true });
    expect(getCrew('builder')).toMatchObject({ tools: 'full' });
    expect(getCrew('conductor')).toMatchObject({ tools: 'delegate-only', delegateOnly: true });
  });
});

describe('no-edits on Claude Code', () => {
  it('runs without Edit, Write and NotebookEdit, and keeps Bash', async () => {
    const t = await H.start('THINK:1', { role: 'reviewer' });
    await H.untilResults(t.id, 1);
    const args: string[] = H.spawns(t.id)[0].args;
    const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
    expect(denied).toEqual(['AskUserQuestion', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
    expect(denied).not.toContain('Bash');
  });
});

describe('no-edits on Codex', () => {
  it('declines a file patch and runs a shell command, with full network access', async () => {
    const t = await H.start('PATCH CMD', { role: 'reviewer', harness: 'codex', model: 'gpt-5.6-sol' });
    const cwd = H.thread(t.id).cwd;
    rmSync(join(cwd, 'codex-patched.txt'), { force: true });
    await H.untilResults(t.id, 1);
    // Codex asks before each patch and each command it does not know to be safe; no read-only sandbox, which would
    // also stop `gh pr diff`.
    expect(codexStart(t.id)).toMatchObject({ approvalPolicy: 'untrusted', sandbox: 'danger-full-access' });
    expect(existsSync(join(cwd, 'codex-patched.txt'))).toBe(false);
    // The command was let through (the fake writes this file only on an accepted approval).
    expect(existsSync(join(cwd, 'codex-approved.txt'))).toBe(true);
    rmSync(join(cwd, 'codex-approved.txt'), { force: true });
    // No approval card: the patch was declined and the command allowed without asking Ben.
    expect(H.byKind(t.id, 'question')).toHaveLength(0);
  });

  it('lets a role with every tool patch files without asking, as before', async () => {
    const t = await H.start('PATCH', { role: 'builder', harness: 'codex', model: 'gpt-5.6-sol' });
    const cwd = H.thread(t.id).cwd;
    await H.untilResults(t.id, 1);
    expect(codexStart(t.id)).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    expect(existsSync(join(cwd, 'codex-patched.txt'))).toBe(true);
    rmSync(join(cwd, 'codex-patched.txt'), { force: true });
  });
});

describe('no-edits on Cursor', () => {
  it('denies file writes only, so its shell still runs', async () => {
    const t = await H.start('CMD hi', { role: 'reviewer', harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' });
    await H.untilResults(t.id, 1);
    const dir = cursorTurn(t.id).cursor_config_dir as string;
    expect(dir).not.toBe(userCursor);
    expect(JSON.parse(readFileSync(join(dir, 'cli-config.json'), 'utf8')).permissions.deny).toEqual(['Read(.env)', 'Write(**)']);
  });
});

describe('the no-edits prompt', () => {
  it('says the edit tools are off and the shell is no way around it, and is only an instruction on remote harnesses', async () => {
    const { buildSystemPrompt } = await import('../runner/prompts.ts');
    const { getCrew } = await import('../crew.ts');
    const t = await H.start('THINK:1');
    await H.untilResults(t.id, 1);
    const thread = H.thread(t.id);
    const channel = H.db.channels.get('scratch')!;
    const local = buildSystemPrompt(thread, channel, getCrew('reviewer'));
    expect(local).toContain('## No file edits');
    expect(local).toContain('your file-edit tools are off. The shell is still yours');
    const remote = buildSystemPrompt({ ...thread, harness: 'hermes' }, channel, getCrew('reviewer'));
    expect(remote).toContain('Omni cannot take the edit tools away on this harness');
    expect(buildSystemPrompt(thread, channel, getCrew('builder'))).not.toContain('## No file edits');
  });
});
