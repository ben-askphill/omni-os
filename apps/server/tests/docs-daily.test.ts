import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '../../../scripts/docs-daily.sh');

function run(args: string[], env: Record<string, string>) {
  return execFileSync(script, args, { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

function git(cwd: string, ...cmd: string[]) {
  return execFileSync('git', cmd, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(root: string) {
  mkdirSync(join(root, 'data', 'docs-daily'), { recursive: true });
  git(root, 'init');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  git(root, 'branch', '-M', 'main');
  git(root, 'remote', 'add', 'origin', root);
}

describe('docs-daily.sh', () => {
  it('noops when only documentation changed in range', () => {
    const root = join(tmpdir(), `docs-daily-${Date.now()}`);
    initRepo(root);
    writeFileSync(join(root, 'README.md'), 'one\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-m', 'base');
    const base = git(root, 'rev-parse', 'HEAD');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'note.md'), 'two\n');
    git(root, 'add', 'docs/note.md');
    git(root, 'commit', '-m', 'docs only');
    const head = git(root, 'rev-parse', 'HEAD');
    git(root, 'update-ref', 'refs/remotes/origin/main', head);
    writeFileSync(join(root, 'data', 'docs-daily', 'last-sha'), `${base}\n`);

    const out = JSON.parse(
      run(['preflight', 'acme/omni'], { OMNI_ROOT: root, DOCS_DAILY_SKIP_FETCH: '1' }),
    );
    expect(out.skip).toBe(true);
    expect(out.reason).toBe('docs_only');
    expect(readFileSync(join(root, 'data', 'docs-daily', 'last-sha'), 'utf8').trim()).toBe(head);
  });

  it('requests work when non-doc files changed', () => {
    const root = join(tmpdir(), `docs-daily-b-${Date.now()}`);
    initRepo(root);
    writeFileSync(join(root, 'README.md'), 'one\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-m', 'base');
    const base = git(root, 'rev-parse', 'HEAD');
    mkdirSync(join(root, 'apps', 'server'), { recursive: true });
    writeFileSync(join(root, 'apps', 'server', 'x.ts'), 'export const x = 1;\n');
    git(root, 'add', 'apps/server/x.ts');
    git(root, 'commit', '-m', 'code');
    const head = git(root, 'rev-parse', 'HEAD');
    git(root, 'update-ref', 'refs/remotes/origin/main', head);
    writeFileSync(join(root, 'data', 'docs-daily', 'last-sha'), `${base}\n`);

    const out = JSON.parse(run(['preflight', 'acme/omni'], { OMNI_ROOT: root, DOCS_DAILY_SKIP_FETCH: '1' }));
    expect(out.skip).toBe(false);
    expect(out.reason).toBe('changes_need_docs');
  });

  it('assert-docs-only rejects non-doc paths', () => {
    const root = join(tmpdir(), `docs-daily-c-${Date.now()}`);
    initRepo(root);
    writeFileSync(join(root, 'README.md'), 'one\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-m', 'base');
    mkdirSync(join(root, 'apps'), { recursive: true });
    writeFileSync(join(root, 'apps', 'bad.ts'), 'x\n');
    git(root, 'add', 'apps/bad.ts');

    expect(() => run(['assert-docs-only'], { OMNI_ROOT: root, DOCS_DAILY_REPO: root })).toThrow();
  });
});
