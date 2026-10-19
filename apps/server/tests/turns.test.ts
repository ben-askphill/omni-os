import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// Each turn's saved diff (apps/server/turns.ts, apps/server/runner/snapshots.ts) against real temp repos and the fake claude
// CLI, whose RUN:<script> directive edits files and runs git during the turn: a commit and a pull made during a turn,
// ignored, binary and oversized files, a save that fails, rapid consecutive turns, and Ben's HEAD and index left alone.

const r = await startRunner();
const { app } = await import('../app.ts');
const { snapshot, turnRef } = await import('../turns.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

let n = 0;
/** A repo on main that ignores .env and ignored/. */
function repo() {
  const dir = join(r.tmp, `turns-repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'one\ntwo\n');
  writeFileSync(join(dir, '.gitignore'), '.env\nignored/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}
const channel = (repoPath: string, worktree = true) => {
  const id = `turns-ch-${++n}`;
  r.db.channels.create({ id, name: id, repo_path: repoPath, use_worktree: worktree ? 1 : 0 });
  return id;
};
/** A shell script the fake CLI runs during a turn (RUN:<path>). */
const script = (body: string) => {
  const file = join(r.tmp, `turn-script-${++n}.sh`);
  writeFileSync(file, `set -e\nexport GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com\n${body}\n`);
  return file;
};
const turns = async (id: string, turn?: string) => {
  const res = await app.request(`/api/threads/${id}/turns${turn ? `?turn=${turn}` : ''}`);
  return { status: res.status, body: (await res.json()) as any };
};
const files = (body: any) => body.groups[0].files.map((f: any) => [f.status, f.path, f.omitted]);
const rows = (id: string) => r.db.turnSnapshots.forThread(id);
/** n turns recorded, the newest settled, and the thread idle. */
const settled = (id: string, count: number, timeout?: number) =>
  waitFor(
    () => {
      const all = rows(id);
      return all.length >= count && ['ready', 'failed'].includes(all[0].state) && !['running', 'queued'].includes(r.thread(id).status) && all;
    },
    () => `${count} settled turns: ${JSON.stringify(rows(id).map((s) => [s.n, s.state, s.error]))}, status ${r.thread(id).status}`,
    timeout,
  );

/** A worktree thread whose first turn has run and been saved. */
async function worktreeThread(dir = repo()) {
  const t = await r.runner.createThread({ channel: channel(dir), prompt: 'start' });
  await r.untilResults(t.id, 1);
  await settled(t.id, 1);
  return { t: r.thread(t.id), repo: dir };
}
async function turn(id: string, text: string, count: number) {
  r.runner.sendMessage(id, text);
  await r.untilResults(id, count);
  return settled(id, count);
}

describe('a turn snapshot', () => {
  it('saves HEAD, staged, unstaged and untracked text without touching HEAD, the index or ignored files', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'staged.txt'), 'staged\n');
    git(dir, 'add', 'staged.txt');
    writeFileSync(join(dir, 'README.md'), 'one\ntwo\nthree\n');
    writeFileSync(join(dir, 'notes.md'), 'note\n');
    writeFileSync(join(dir, '.env'), 'TOKEN=secret\n');
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2]));
    const index = join(dir, '.git', 'index');
    const hash = () => createHash('sha256').update(readFileSync(index)).digest('hex');
    const [head, idx, status] = [git(dir, 'rev-parse', 'HEAD'), hash(), git(dir, 'status', '--porcelain', '-uall')];

    const snap = await snapshot(dir, 'refs/omni/turns/test/one/before');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(hash()).toBe(idx);
    expect(git(dir, 'status', '--porcelain', '-uall')).toBe(status);
    expect(snap.head).toBe(head);
    expect(git(dir, 'rev-parse', 'refs/omni/turns/test/one/before')).toBe(snap.sha);
    expect(git(dir, 'rev-parse', `${snap.sha}^`)).toBe(head);
    expect(git(dir, 'ls-tree', '-r', '--name-only', snap.sha).split('\n')).toEqual(['.gitignore', 'README.md', 'notes.md', 'staged.txt']);
    expect(git(dir, 'show', `${snap.sha}:README.md`)).toBe('one\ntwo\nthree');
    expect(snap.skipped).toEqual([{ path: 'blob.bin', reason: 'binary' }]);
    // A snapshot is never replaced.
    await expect(snapshot(dir, 'refs/omni/turns/test/one/before')).rejects.toThrow();
  });
});

describe("each turn's saved diff", () => {
  it('shows what the turn changed, its commit included, Ben\'s own edits before it not, and stays the same after later edits', async () => {
    const { t } = await worktreeThread();
    const wt = t.cwd;
    const first = (await turns(t.id)).body;
    expect(first).toMatchObject({ available: true, reason: null });
    expect(first.turns).toHaveLength(1);
    expect(first.turn).toMatchObject({ n: 1, state: 'ready', error: null });
    expect(first.groups).toEqual([{ kind: 'turn', files: [], truncated: false }]);

    // Ben's own work between turns is in the next turn's before snapshot, so not in its diff.
    writeFileSync(join(wt, 'mine.txt'), 'mine\n');
    git(wt, 'add', 'mine.txt');
    writeFileSync(join(wt, 'README.md'), 'one\ntwo\nben\n');
    const startHead = git(wt, 'rev-parse', 'HEAD');
    const run = script(
      [
        'printf "agent\\n" >> README.md',
        'printf "export const x = 1;\\n" > feature.ts',
        'git add feature.ts && git commit -q -m feature',
        'printf "TOKEN=secret\\n" > .env',
        'mkdir -p ignored && printf "x\\n" > ignored/x.txt',
        'printf "a note\\n" > notes.md',
        "printf '\\000\\001' > blob.bin",
        'head -c 1100000 /dev/zero | tr "\\0" "x" > big.log',
      ].join('\n'),
    );
    const [two] = await turn(t.id, `RUN:${run}`, 2);
    expect(two.state).toBe('ready');

    const { body } = await turns(t.id);
    expect(body.turns.map((x: any) => x.n)).toEqual([2, 1]);
    expect(body.turn).toMatchObject({ id: two.id, n: 2, state: 'ready', error: null });
    // HEAD moved during the turn: its own commit.
    const endHead = git(wt, 'rev-parse', 'HEAD');
    expect(endHead).not.toBe(startHead);
    expect(body.turn.before).toEqual({ sha: two.before_sha, ref: turnRef(t.id, two.id, 'before'), head: startHead });
    expect(body.turn.after).toEqual({ sha: two.after_sha, ref: turnRef(t.id, two.id, 'after'), head: endHead });
    // The turn's Result, the same id as in Needs you.
    expect(body.turn.completion_uid).toBe(r.db.completions.latest(t.id)!.uid);
    expect(body.turns[1].completion_uid).toBe(r.db.completions.forThread(t.id)[0].uid);

    expect(files(body)).toEqual([
      ['modified', 'README.md', null],
      ['added', 'feature.ts', null],
      ['added', 'notes.md', null],
      ['added', 'big.log', 'too_large'],
      ['added', 'blob.bin', 'binary'],
    ]);
    const readme = body.groups[0].files[0];
    expect(readme).toMatchObject({ additions: 1, deletions: 0 });
    expect(readme.diff).toContain('\n ben\n+agent\n');
    expect(JSON.stringify(body)).not.toContain('TOKEN=secret');

    // Omni left the branch and Ben's index where the turn did.
    expect(git(wt, 'branch', '--show-current')).toBe(t.branch);
    expect(git(wt, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(wt, 'status', '--porcelain')).toContain('M README.md');

    // Later edits and commits do not change a saved turn.
    writeFileSync(join(wt, 'README.md'), 'rewritten\n');
    git(wt, 'commit', '-q', '-am', 'later');
    const again = (await turns(t.id, two.id)).body;
    expect(again.turn).toEqual(body.turn);
    expect(again.groups).toEqual(body.groups);
    // An older turn by its id.
    expect((await turns(t.id, first.turn.id)).body.turn.id).toBe(first.turn.id);
  });

  it('includes what a pull brought in, as a before/after snapshot does', async () => {
    const { t, repo: main } = await worktreeThread();
    writeFileSync(join(main, 'upstream.txt'), 'from main\n');
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'upstream');
    const [s] = await turn(t.id, `RUN:${script(`git pull -q --ff-only --no-rebase "${main}" main`)}`, 2);
    expect(s.state).toBe('ready');
    expect(s.after_head).toBe(git(main, 'rev-parse', 'HEAD'));
    expect(s.before_head).not.toBe(s.after_head);
    expect(files((await turns(t.id)).body)).toEqual([['added', 'upstream.txt', null]]);
  });

  it('fails the snapshot with its reason, never the turn', async () => {
    const { t } = await worktreeThread();
    // A required clean filter that fails: git cannot add the file the turn wrote.
    git(t.cwd, 'config', 'filter.broken.clean', 'false');
    git(t.cwd, 'config', 'filter.broken.required', 'true');
    const run = script('printf "*.dat filter=broken\\n" > .gitattributes\nprintf "x\\n" > data.dat');
    const [s] = await turn(t.id, `RUN:${run}`, 2);
    expect(r.thread(t.id).status).toBe('done');
    expect(r.db.completions.latest(t.id)!.status).toBe('done');
    expect(s.state).toBe('failed');
    expect(s.error).toMatch(/^Could not save the checkout after this turn: /);
    expect(s.completion_uid).toBe(r.db.completions.latest(t.id)!.uid);
    const { body } = await turns(t.id);
    expect(body.turn).toMatchObject({ state: 'failed', error: s.error, after: null });
    expect(body.groups).toEqual([]);

    // A turn that leaves its worktree's branch cannot be saved from it either.
    rmSync(join(t.cwd, '.gitattributes'));
    rmSync(join(t.cwd, 'data.dat'));
    const [off] = await turn(t.id, `RUN:${script('git checkout -q -b elsewhere')}`, 3);
    expect(off.state).toBe('failed');
    expect(off.error).toMatch(/not omni\//);
  });

  it('shows the Result at once while a slow save settles, and keeps rapid consecutive turns apart', async () => {
    const dir = repo();
    // A slow clean filter on *.txt: every save that adds a changed .txt file takes a second.
    writeFileSync(join(dir, '.gitattributes'), '*.txt filter=slow\n');
    writeFileSync(join(dir, 'log.txt'), 'start\n');
    git(dir, 'config', 'filter.slow.clean', 'sleep 1; cat');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'slow');
    const { t } = await worktreeThread(dir);

    r.runner.sendMessage(t.id, `RUN:${script('printf "a\\n" >> log.txt')}`);
    // Done while the after snapshot is still being saved.
    await r.untilResults(t.id, 2);
    expect(r.thread(t.id).status).toBe('done');
    expect(rows(t.id)[0].state).toBe('capturing');
    // The next turn starts at once; its message waits for its before snapshot, behind the last turn's after one.
    r.runner.sendMessage(t.id, `RUN:${script('printf "b\\n" >> log.txt')}`);
    await r.untilResults(t.id, 3, 15_000);
    const [b, a] = await settled(t.id, 3, 15_000);
    expect([a.state, b.state]).toEqual(['ready', 'ready']);
    const diffA = (await turns(t.id, a.id)).body.groups[0].files[0].diff;
    const diffB = (await turns(t.id, b.id)).body.groups[0].files[0].diff;
    expect(diffA).toContain('\n start\n+a\n');
    expect(diffA).not.toContain('+b');
    expect(diffB).toContain('\n a\n+b\n');
    expect(diffB).not.toContain('+a');
    const results = r.db.completions.forThread(t.id);
    expect([a.completion_uid, b.completion_uid]).toEqual([results[1].uid, results[2].uid]);
  }, 30_000);

  it('lets a turn go without its before snapshot when saving takes too long, and the late one never lands', async () => {
    const dir = repo();
    writeFileSync(join(dir, '.gitattributes'), '*.txt filter=slow\n');
    writeFileSync(join(dir, 'log.txt'), 'start\n');
    git(dir, 'config', 'filter.slow.clean', 'sleep 1; cat');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'slow');
    const { t } = await worktreeThread(dir);
    writeFileSync(join(t.cwd, 'log.txt'), 'start\nben\n');
    const wait = r.config.turnSnapshotWaitMs;
    r.config.turnSnapshotWaitMs = 100;
    try {
      const [s] = await turn(t.id, 'go on', 2);
      expect(s).toMatchObject({ state: 'failed', error: 'Saving the checkout before this turn took too long, so the turn ran without it.' });
      // The save still running when the wait ran out finishes later, and changes nothing.
      await new Promise((done) => setTimeout(done, 1500));
      expect(r.db.turnSnapshots.get(s.id)).toMatchObject({ state: 'failed', before_sha: null, after_sha: null });
    } finally {
      r.config.turnSnapshotWaitMs = wait;
    }
  }, 20_000);

  it('answers 404 for a turn of another thread', async () => {
    const one = await worktreeThread();
    const two = await worktreeThread();
    const other = rows(two.t.id)[0].id;
    expect((await turns(one.t.id, other)).status).toBe(404);
    expect((await turns('nope')).status).toBe(404);
  });

  it('saves nothing for a thread that runs in the repo itself, and says why', async () => {
    const dir = repo();
    const t = await r.runner.createThread({ channel: channel(dir, false), prompt: 'start' });
    await r.untilResults(t.id, 1);
    expect(rows(t.id)).toEqual([]);
    expect((await turns(t.id)).body).toEqual({
      available: false,
      reason: 'Turns are saved only for a thread with a worktree of its own.',
      turns: [],
      turn: null,
      groups: [],
    });
    expect(git(dir, 'for-each-ref', 'refs/omni')).toBe('');
  });
});

describe('the snapshot rows', () => {
  it('never let a stale save land on a settled turn, and a restart fails the unsettled ones', async () => {
    const t = await r.start('rows');
    await r.untilResults(t.id, 1);
    const id = `stale-${++n}`;
    r.db.turnSnapshots.start(id, t.id, 0);
    expect(r.db.turnSnapshots.fail(id, 'too long')).toBe(true);
    expect(r.db.turnSnapshots.saveBefore(id, { sha: 'a', head: 'b', skipped: [] })).toBe(false);
    expect(r.db.turnSnapshots.end(id, null)).toBe(true);
    expect(r.db.turnSnapshots.saveAfter(id, { sha: 'a', head: 'b', skipped: [] })).toBe(false);
    expect(r.db.turnSnapshots.get(id)).toMatchObject({ state: 'failed', error: 'too long', before_sha: null });

    const open = `open-${n}`;
    r.db.turnSnapshots.start(open, t.id, 0);
    expect(r.db.turnSnapshots.failUnsettled('restarted')).toBe(1);
    expect(r.db.turnSnapshots.get(open)).toMatchObject({ state: 'failed', error: 'restarted' });
  });
});
