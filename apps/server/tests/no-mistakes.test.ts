import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The no-mistakes gate is optional. The prompt mentions it only when the binary is on PATH and the
// thread's cwd is the root of a checkout that has the remote. A missing binary, a subfolder, a
// delegate-only role, and a provider harness all stay on plain git push.

const r = await startRunner();
const { buildSystemPrompt } = await import('../runner/prompts.ts');
const { noMistakesGate } = await import('../no-mistakes.ts');
const { getCrew } = await import('../crew.ts');

const barePath = { ...process.env, PATH: '/usr/bin:/bin' };

function git(cwd: string, args: string[]) {
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    stdio: 'ignore',
  });
}

function repoWithRemote() {
  const parent = mkdtempSync(join(tmpdir(), 'omni-nm-'));
  const cwd = join(parent, 'repo');
  mkdirSync(cwd);
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['remote', 'add', 'no-mistakes', join(parent, 'gate.git')]);
  return { parent, cwd };
}

function pathWithBinary(base = process.env.PATH ?? '') {
  const bin = mkdtempSync(join(tmpdir(), 'omni-nm-bin-'));
  writeFileSync(join(bin, 'no-mistakes'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return `${bin}${delimiter}${base}`;
}

describe('no-mistakes detection', () => {
  it('requires the command and the remote at the checkout root', () => {
    const { parent, cwd } = repoWithRemote();
    const env = { ...process.env, PATH: pathWithBinary() };
    expect(noMistakesGate(cwd, env)).toBe(true);
    expect(noMistakesGate(cwd, barePath)).toBe(false);

    const plain = join(parent, 'plain');
    mkdirSync(plain);
    git(plain, ['init', '-q', '-b', 'main']);
    expect(noMistakesGate(plain, env)).toBe(false);

    const sub = join(cwd, 'apps');
    mkdirSync(sub);
    expect(noMistakesGate(sub, env)).toBe(false);
    expect(noMistakesGate('', env)).toBe(false);
    expect(noMistakesGate(join(parent, 'missing'), env)).toBe(false);
  });

  it('sees the remote from a linked worktree', () => {
    const { parent, cwd } = repoWithRemote();
    git(cwd, ['commit', '--allow-empty', '-m', 'init']);
    const wt = join(parent, 'wt');
    git(cwd, ['worktree', 'add', '-q', '-b', 'feature', wt]);
    const env = { ...process.env, PATH: pathWithBinary() };
    expect(noMistakesGate(wt, env)).toBe(true);
  });
});

describe('shipping prompt', () => {
  it('tells a local worker to drive the gate, and leaves everyone else on plain push', async () => {
    const { cwd } = repoWithRemote();
    const saved = process.env.PATH;
    process.env.PATH = pathWithBinary();
    try {
      const started = await r.start('THINK:1');
      await r.untilResults(started.id, 1);
      const thread = r.thread(started.id);
      const channel = r.db.channels.get('scratch')!;
      const onGate = { ...thread, cwd, branch: 'omni/abc' };

      const builder = buildSystemPrompt(onGate, channel, getCrew('builder'));
      expect(builder).toContain('## Shipping');
      expect(builder).toContain('no-mistakes axi run --intent');
      expect(builder).toContain('Shipping below is how a push or a PR leaves this checkout.');
      expect(builder).not.toContain('Commit here; open a PR when asked.');
      expect(builder.indexOf('## Your role: Builder')).toBeLessThan(builder.indexOf('## Shipping'));

      const noBranch = buildSystemPrompt({ ...thread, cwd, branch: null }, channel);
      expect(noBranch).toContain('## Shipping');
      expect(noBranch).not.toContain('dedicated git worktree');

      for (const harness of ['hermes', 'cursor-cloud']) {
        expect(buildSystemPrompt({ ...onGate, harness }, channel, getCrew('builder'))).not.toContain('## Shipping');
      }
      expect(buildSystemPrompt(onGate, channel, getCrew('conductor'))).not.toContain('## Shipping');
      expect(buildSystemPrompt({ ...onGate, harness: 'codex' }, channel, getCrew('builder'))).toContain('## Shipping');
      expect(buildSystemPrompt({ ...onGate, harness: 'cursor' }, channel, getCrew('builder'))).toContain('## Shipping');
      expect(buildSystemPrompt(thread, channel, getCrew('builder'))).not.toContain('## Shipping');
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe('repo config', () => {
  it('parses the committed policy', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const doc = parse(readFileSync(join(root, '.no-mistakes.yaml'), 'utf8')) as {
      commands: { prepare: string; lint: string; test?: string };
      gates: { name: string; after: string; command: string }[];
      test: { prepare: boolean; instructions: string };
      document: { instructions: string };
      pr: { template: string; appendix: string };
      no_ci: boolean;
      allow_repo_commands?: boolean;
      agent?: string;
    };
    expect(doc.commands.prepare).toBe('npm ci --include=dev --prefer-offline');
    expect(doc.commands.lint).toBe('npm run unused');
    expect(doc.commands.test).toBeUndefined();
    expect(doc.gates.map((g) => [g.name, g.after, g.command])).toEqual([
      ['typecheck', 'lint', 'npm run typecheck'],
      ['suite', 'lint', 'npm test'],
      ['build', 'lint', 'npm run build'],
    ]);
    expect(doc.test.prepare).toBe(true);
    expect(doc.test.instructions).toContain('scripts/qa-stack.sh');
    expect(doc.test.instructions).toContain('4747');
    expect(doc.document.instructions).toContain('CONTEXT.md');
    expect(doc.pr.template).toBe('.github/pull_request_template.md');
    expect(doc.pr.appendix).toBe('collapsed');
    expect(doc.no_ci).toBe(true);
    expect(doc.allow_repo_commands).toBeUndefined();
    expect(doc.agent).toBeUndefined();
  });
});
