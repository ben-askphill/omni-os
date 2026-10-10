import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let modDirs: () => string[];

beforeAll(async () => {
  H = await startRunner({ OMNI_MODS: '1' });
  ({ modDirs } = await import('../server/harness/claude/adapter.ts'));
});

afterEach(() => {
  H.config.mods = true;
});

/** The values that follow each `--plugin-dir` in a thread's stream-json invocation. */
async function pluginDirs(prompt: string) {
  const t = await H.start(prompt);
  await H.untilResults(t.id, 1);
  const args: string[] = H.spawns(t.id)[0].args;
  return args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));
}

describe('mods', () => {
  it('OMNI_MODS=1 turns the flag on and points at the repo mod', () => {
    expect(H.config.mods).toBe(true);
    expect(H.paths.modProgress).toBe(join(H.paths.mods, 'omni-progress'));
    expect(modDirs()).toEqual([H.paths.modProgress]);
  });

  it('the omni-progress mod is a plugin folder with a hooks module', () => {
    const manifest = JSON.parse(readFileSync(join(H.paths.modProgress, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('omni-progress');
    expect(manifest.userConfig.watchBash.default).toBe(false);
    const hooks = JSON.parse(readFileSync(join(H.paths.modProgress, 'hooks', 'hooks.json'), 'utf8'));
    for (const m of hooks.modules) expect(existsSync(join(H.paths.modProgress, 'hooks', m))).toBe(true);
  });

  it('passes --plugin-dir for each enabled mod when the flag is on', async () => {
    expect(await pluginDirs('with mods')).toEqual([H.paths.modProgress]);
  });

  it('passes no --plugin-dir when the flag is off', async () => {
    H.config.mods = false;
    expect(modDirs()).toEqual([]);
    expect(await pluginDirs('without mods')).toEqual([]);
  });
});
