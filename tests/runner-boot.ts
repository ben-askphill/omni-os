import { afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_CLAUDE, fakeAlive, waitFor } from './support.ts';

// Boots the real runner against a throwaway data dir and the fake claude CLI.
// Env must be set before the first import of server modules, so each test file calls this once at the top.
// No Keychain (fresh db has no secrets), no browser MCP, no network, no real claude.

export type Ev = { id: number; kind: string; p: any };

export async function startRunner(env: Record<string, string> = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'omni-runner-'));
  const log = join(tmp, 'fake-claude.jsonl');
  const stdinLog = join(tmp, 'fake-claude-stdin.jsonl');
  const codexLog = join(tmp, 'fake-codex.jsonl');
  const cursorLog = join(tmp, 'fake-cursor.jsonl');
  const scratch = join(tmp, 'scratch');
  const brain = join(tmp, 'brain');
  mkdirSync(scratch);
  mkdirSync(brain);
  Object.assign(process.env, {
    OMNI_DATA_DIR: join(tmp, 'data'),
    OMNI_CLAUDE_BIN: FAKE_CLAUDE,
    OMNI_BROWSER: '0',
    OMNI_BRAIN_DIR: brain,
    OMNI_DEFAULT_MODEL: 'sonnet',
    OMNI_MAX_CONCURRENT: '8',
    OMNI_KEEPALIVE_SECONDS: '60',
    OMNI_INTERRUPT_GRACE_MS: '1000',
    FAKE_CLAUDE_LOG: log,
    FAKE_CLAUDE_STDIN_LOG: stdinLog,
    FAKE_CLAUDE_LATENCY_MS: '10',
    FAKE_CODEX_LOG: codexLog,
    FAKE_CURSOR_LOG: cursorLog,
    ...env,
  });

  const { config, paths } = await import('../server/config.ts');
  if (!paths.db.startsWith(tmp)) {
    throw new Error(`server/config.ts ignores OMNI_DATA_DIR (db is ${paths.db}); refusing to run the runner against the real data/`);
  }
  const db = await import('../server/db.ts');
  const runner = await import('../server/runner.ts');
  const { bus } = await import('../server/bus.ts');
  db.channels.create({ id: 'scratch', name: 'Scratch', kind: 'internal', use_worktree: 0, base_dir: scratch });

  // Every status a thread went through, deduped, from the feed the UI listens to.
  const statusLog = new Map<string, string[]>();
  bus.on('feed', (e: any) => {
    if (e.type !== 'thread') return;
    const seen = statusLog.get(e.thread.id) ?? [];
    if (seen.at(-1) !== e.thread.status) seen.push(e.thread.status);
    statusLog.set(e.thread.id, seen);
  });

  const invocations = (): any[] =>
    existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const claudeStdin = (): any[] =>
    existsSync(stdinLog) ? readFileSync(stdinLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const codexRequests = (): any[] =>
    existsSync(codexLog) ? readFileSync(codexLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const cursorRequests = (): any[] =>
    existsSync(cursorLog) ? readFileSync(cursorLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

  afterAll(async () => {
    await runner.shutdownAll?.();
    // Safety net: never leave a fake CLI behind, whatever the runner did.
    for (const { pid } of invocations()) if (fakeAlive(pid)) process.kill(pid, 'SIGKILL');
    for (const { pid } of codexRequests()) if (fakeAlive(pid, 'fake-codex.mjs')) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    for (const { pid } of cursorRequests()) if (fakeAlive(pid, 'fake-cursor.mjs')) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    db.db.close();
    rmSync(tmp, { recursive: true, force: true });
  }, 15_000);

  const TRANSCRIPT = new Set(['user', 'crew_report', 'tool_use', 'tool_result', 'assistant_text', 'result', 'error']);
  const events = (id: string): Ev[] => db.events.since(id).map((r) => ({ id: r.id, kind: r.kind, p: JSON.parse(r.payload) }));
  const byKind = (id: string, kind: string) => events(id).filter((e) => e.kind === kind);
  const thread = (id: string) => db.threads.get(id)!;
  const describeThread = (id: string) => `status ${thread(id).status}, transcript ${JSON.stringify(flow(id))}`;
  const flow = (id: string) => events(id).filter((e) => TRANSCRIPT.has(e.kind)).map((e) => e.kind);

  return {
    tmp, config, paths, db, runner, bus,
    start: (prompt: string, extra: Record<string, unknown> = {}) => runner.createThread({ channel: 'scratch', prompt, ...extra }),
    events,
    byKind,
    flow,
    texts: (id: string, kind: string) => byKind(id, kind).map((e) => e.p.text as string),
    thread,
    statuses: (id: string) => statusLog.get(id) ?? [],
    invocations,
    /** What a thread's claude processes read on stdin, in order: `user`, or `control_request:<subtype>`. */
    claudeStdin: (id: string) =>
      claudeStdin().filter((l) => l.thread_id === id).map((l) => (l.subtype ? `${l.type}:${l.subtype}` : l.type) as string),
    codexRequests,
    /** Codex app-server processes spawned, oldest first (one per thread). */
    codexPids: () => [...new Set(codexRequests().map((r) => r.pid))],
    cursorRequests,
    /** Long-lived stream-json processes spawned for a thread, oldest first. */
    spawns: (id: string) => invocations().filter((i) => i.mode === 'stream' && i.thread_id === id),
    fakeAlive,
    until: <T>(label: string, fn: () => T | undefined | null | false, timeout?: number) => waitFor(fn, label, timeout),
    untilTool: (id: string, n = 1) =>
      waitFor(() => byKind(id, 'tool_use').length >= n, () => `tool_use #${n}: ${describeThread(id)}`),
    untilStatus: (id: string, status: string, timeout?: number) =>
      waitFor(() => thread(id).status === status, () => `status ${status}: ${describeThread(id)}`, timeout),
    /** n results recorded and the thread no longer busy. */
    untilResults: (id: string, n: number, timeout?: number) =>
      waitFor(
        () => byKind(id, 'result').length >= n && !['running', 'queued'].includes(thread(id).status),
        () => `${n} results and an idle thread: ${describeThread(id)}`,
        timeout,
      ),
  };
}
