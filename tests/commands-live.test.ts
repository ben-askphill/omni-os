import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The command list against the Claude Code and Codex CLIs Ben really runs. The fakes in fixtures/
// answer the way the CLIs did when the fixtures were captured, so only this catches an upgrade
// that changed the answer. Listing starts no turn and spends nothing, but it needs the real CLIs
// and their logins, so it only runs on request:
//   OMNI_LIVE_COMMANDS=1 npx vitest run --config tests/vitest.config.ts tests/commands-live.test.ts
const LIVE = process.env.OMNI_LIVE_COMMANDS === '1';

const r = LIVE ? await startRunner({ OMNI_CLAUDE_BIN: 'claude', OMNI_CODEX_BIN: 'codex' }) : null!;
const svc = LIVE ? await import('../server/commands.ts') : null!;

describe.skipIf(!LIVE)('the real Claude Code CLI', () => {
  it("lists a folder's commands without leaving a session behind", async () => {
    const dir = realpathSync(mkdtempSync(join(r.tmp, 'live-')));
    mkdirSync(join(dir, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'commands', 'omni-live-check.md'), '---\ndescription: Omni live check\n---\nSay hi.\n');

    const list = await svc.listCommands('claude-code', dir, { wait: true });
    expect(list.status).toBe('ready');
    expect(list.commands).toContainEqual({ name: 'omni-live-check', description: 'Omni live check', source: 'project', mentionable: true });
    expect(list.commands).toContainEqual(expect.objectContaining({ name: 'compact', source: 'builtin', mentionable: false }));
    const names = list.commands.map((c) => c.name);
    for (const hidden of ['login', 'config', 'mcp', 'clear', 'model']) expect(names).not.toContain(hidden);
    for (const c of list.commands) expect(c.description).not.toMatch(/\n|\((user|project)\)$/);

    // Claude Code keeps a folder's sessions under ~/.claude/projects/<folder with - for / and .>.
    expect(existsSync(join(homedir(), '.claude', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-')))).toBe(false);
  }, 30_000);
});

describe.skipIf(!LIVE)('the real Codex CLI', () => {
  it("lists a folder's skills with the file each one loads from", async () => {
    const dir = realpathSync(mkdtempSync(join(r.tmp, 'live-codex-')));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const file = join(dir, '.agents', 'skills', 'omni-live-check', 'SKILL.md');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '---\nname: omni-live-check\ndescription: Omni live check\n---\nSay hi.\n');

    const list = await svc.listCommands('codex', dir, { wait: true });
    expect(list.status).toBe('ready');
    expect(list.commands).toContainEqual({ name: 'omni-live-check', description: 'Omni live check', source: 'project', mentionable: true, path: file });
    // Codex bundles a few system skills, such as skill-creator.
    expect(list.commands).toContainEqual(expect.objectContaining({ source: 'builtin', mentionable: true }));
    for (const c of list.commands) {
      expect(c.path).toMatch(/\/SKILL\.md$/);
      expect(c.description).not.toContain('\n');
    }
  }, 30_000);
});
