import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Quick asks (apps/server/quick-ask.ts, packages/shared/quick-ask.ts): answered in place with read-only tools, in a
// `none` or `read` workspace with no worktree, charter, folder or task id, out of every list but Recent asks, and
// turned into a task only by Ben (Keep as thread, Make it a task); the agent's TASK line suggests one.
// A short keepalive, so a kept ask's next turn starts a new process with the flags it has by then.
const H = await startRunner({ OMNI_KEEPALIVE_SECONDS: '1' });
const { startQuickAsk, keepQuickAsk, taskFromQuickAsk } = await import('../quick-ask.ts');
const { needsYou } = await import('../db/repos/needs-you.ts');
const T = { timeout: 20_000 };

// A repo channel with worktrees on: a task there gets a worktree, a quick ask reads the checkout.
const repo = mkdtempSync(join(tmpdir(), 'omni-quick-repo-'));
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, 'a.txt'), 'a\n');
for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a']]) execFileSync('git', args, { cwd: repo });
H.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 1, repo_path: repo } as any);

const listed = (id: string) => ({
  list: H.db.threads.list({ limit: 500 }).some((t) => t.id === id),
  channel: H.db.threads.byChannel('shop').some((t) => t.id === id),
  inbox: needsYou().items.some((i) => i.thread.id === id),
  asks: H.db.threads.recentAsks(7).some((t) => t.id === id),
});

describe('quick asks', () => {
  it('reads the channel checkout with no worktree, charter or task id, and stays out of every list but Recent asks', T, async () => {
    const t = await startQuickAsk({ channel: 'shop', prompt: 'what does a.txt say?', source: 'capture' });
    expect(t).toMatchObject({ quick: 1, workspace: 'read', cwd: repo, branch: null, setup: null, role: null, task_id: null, folder_id: null });
    await H.untilResults(t.id, 1);
    const args: string[] = H.spawns(t.id)[0].args;
    const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
    for (const tool of ['Bash', 'Edit', 'Write', 'mcp__omni-browser']) expect(denied).toContain(tool);
    expect(H.thread(t.id)).toMatchObject({ quick: 1, promoted_to: null });
    expect(listed(t.id)).toEqual({ list: false, channel: false, inbox: false, asks: true });
  });

  it("only suggests a task on the agent's TASK line, and Ben's Make it a task starts it from the ask", T, async () => {
    const t = await startQuickAsk({ channel: 'shop', prompt: 'rename a.txt NEEDS_TASK:Rename-a.txt' });
    await H.untilResults(t.id, 1);
    await H.until('suggested', () => H.byKind(t.id, 'task_suggested')[0]);
    // A TASK line in the answer, which text the agent read could have planted, starts nothing.
    expect(H.byKind(t.id, 'task_suggested')[0].p).toMatchObject({ title: 'Rename a.txt' });
    expect(H.thread(t.id)).toMatchObject({ quick: 1, promoted_to: null });
    expect(H.db.threads.list({ limit: 500 }).filter((x) => x.title === 'Rename a.txt')).toEqual([]);

    const { task } = await taskFromQuickAsk(t.id);
    const ask = H.thread(t.id);
    expect(ask).toMatchObject({ quick: 0, promoted_to: task.id });
    expect(task).toMatchObject({ quick: 0, channel_id: 'shop', title: 'Rename a.txt' });
    expect(task.branch).toMatch(/^omni\//);
    expect(H.byKind(t.id, 'promoted')[0].p).toEqual({ thread_id: task.id, title: 'Rename a.txt' });
    await H.untilResults(task.id, 1);
    expect(H.claudeTexts(task.id)[0]).toContain('rename a.txt');
    // The ask stays under Recent asks, with the task it became.
    expect(listed(t.id).asks).toBe(true);
    // Once is enough: asking again hands back the same task.
    expect((await taskFromQuickAsk(t.id)).task.id).toBe(task.id);
  });

  it('becomes an ordinary thread where it is on Keep, still read-only', T, async () => {
    const t = await startQuickAsk({ channel: 'shop', prompt: 'keep me' });
    await H.untilResults(t.id, 1);
    const kept = keepQuickAsk(t.id);
    expect(kept).toMatchObject({ quick: 0, workspace: 'read', cwd: repo, branch: null });
    expect(listed(t.id)).toMatchObject({ list: true, channel: true });
    // Its next turn, in a new process, keeps the read-only tools, and it can still become a task.
    await H.until('process closed', () => !H.runner.isLive(t.id), 5000);
    H.runner.sendMessage(t.id, 'and now?');
    await H.untilResults(t.id, 2);
    expect(H.spawns(t.id)).toHaveLength(2);
    const args: string[] = H.spawns(t.id)[1].args;
    const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
    for (const tool of ['Bash', 'Edit', 'Write']) expect(denied).toContain(tool);
    expect((await taskFromQuickAsk(t.id)).task.branch).toMatch(/^omni\//);
  });

  it('runs on Auto unless a run is asked for, and is refused on Hermes and Cursor Cloud', T, async () => {
    await expect(startQuickAsk({ channel: 'shop', prompt: 'hi', harness: 'hermes' })).rejects.toThrow(/cannot run on the Hermes server/);
    await expect(startQuickAsk({ channel: 'shop', prompt: 'hi', harness: 'cursor-cloud' })).rejects.toThrow(/cannot run as a Cursor cloud agent/);
    const t = await startQuickAsk({ channel: 'shop', prompt: 'hi' });
    expect(t.auto_reason).toBeTruthy();
    await H.untilResults(t.id, 1);
  });
});
