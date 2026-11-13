import { execFileSync, spawnSync } from 'node:child_process';
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

  describe('merge-when-ready', () => {
    // A gh that reports the PR open. Each round of polling takes one line of `checks`: "<merge state> <failed count>
    // <exit code>", the way gh pr checks exits 8 while checks are pending and 1 when one failed. A count of "-" prints
    // nothing, as gh does when the PR has no checks at all (it says so on stderr and exits 1).
    function fakeGh(checks: string[]) {
      const root = join(tmpdir(), `docs-daily-gh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const bin = join(root, 'bin');
      mkdirSync(join(root, 'data', 'logs'), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(root, 'checks'), `${checks.join('\n')}\n`);
      writeFileSync(
        join(bin, 'gh'),
        `#!/usr/bin/env bash
dir="$(dirname "$0")/.."
echo "$*" >>"$dir/calls"
case "$1 $2" in
  "pr view")
    case "$*" in
      *"-q .state"*) echo OPEN ;;
      *"-q .mergeable"*) echo MERGEABLE ;;
      *"-q .mergeStateStatus"*) head -n1 "$dir/checks" | cut -d' ' -f1 ;;
    esac ;;
  "pr checks")
    line="$(head -n1 "$dir/checks")"; sed -i.bak 1d "$dir/checks"
    set -- $line; [ "$2" = - ] || echo "$2"; exit "$3" ;;
  "pr merge") exit 0 ;;
esac
`,
        { mode: 0o755 },
      );
      const res = spawnSync(script, ['merge-when-ready', '7', 'acme/omni'], {
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, OMNI_ROOT: root, DOCS_DAILY_POLL_SECONDS: '0', PATH: `${bin}:${process.env.PATH}` },
      });
      const calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
      return { ...res, merged: calls.some((c) => c.startsWith('pr merge')) };
    }

    it('waits through pending checks and then merges', () => {
      const res = fakeGh(['BLOCKED 0 8', 'CLEAN 0 0']);
      expect(res.stderr).not.toMatch(/syntax error/);
      expect(res.stderr).toMatch(/waiting for checks \(attempt 1\//);
      expect(res.status).toBe(0);
      expect(res.merged).toBe(true);
    });

    it('merges a PR that has no checks', () => {
      const res = fakeGh(['CLEAN - 1']);
      expect(res.stderr).not.toMatch(/syntax error/);
      expect(res.status).toBe(0);
      expect(res.merged).toBe(true);
    });

    it('stops without merging when a check failed', () => {
      const res = fakeGh(['BLOCKED 1 1']);
      expect(res.stderr).not.toMatch(/syntax error/);
      expect(res.stderr).toMatch(/1 failed check/);
      expect(res.status).not.toBe(0);
      expect(res.merged).toBe(false);
    });
  });
});
