import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The command list against the Claude Code CLI Ben really runs. The fake in fixtures/ answers
// `initialize` the way Claude Code did when the fixture was captured, so only this catches an
// upgrade that changed the answer. Listing starts no turn and spends nothing, but it needs the
// real CLI and its login, so it only runs on request:
//   OMNI_LIVE_COMMANDS=1 npx vitest run --config tests/vitest.config.ts tests/commands-live.test.ts
const LIVE = process.env.OMNI_LIVE_COMMANDS === '1';

const r = LIVE ? await startRunner({ OMNI_CLAUDE_BIN: 'claude' }) : null!;
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
