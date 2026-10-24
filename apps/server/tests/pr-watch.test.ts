import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Watch PR (apps/server/pr-watch/) against a fake GitHub and the fake claude CLI: a new failing check wakes the
// thread once, keyed by head and check, through a durable request; unchanged, replayed and shared polls cost
// nothing; GitHub failures back off and stop the watch; stop, archive and merge end it.

let H: Awaited<ReturnType<typeof startRunner>>;
let W: typeof import('../pr-watch/worker.ts');
let S: typeof import('../pr-watch/store.ts');
let G: typeof import('../pr-watch/gh.ts');
let app: (typeof import('../app.ts'))['app'];

const T = { timeout: 20_000 };
const REPO = 'acme/app';
const MIN = 60_000;

type Check = { id: string; name: string; state: string; url: string | null };
type PR = { state: 'OPEN' | 'MERGED' | 'CLOSED'; headSha: string; checks: Check[] };

/** A GitHub that answers from `prs`, counts its reads, and fails while `fail` is set. */
function fakeGitHub() {
  const prs = new Map<number, PR>();
  const gh = {
    prs,
    now: Date.parse('2026-10-24T10:00:00Z'),
    reads: 0,
    logReads: 0,
    fail: null as string | null,
    /** Held open while set, so a test can act between observing and waking. */
    logGate: null as Promise<void> | null,
    woken: [] as string[],
    deps: {
      observe: async (repo: string, number: number) => {
        gh.reads++;
        if (gh.fail) throw new Error(`Command failed: gh pr view\n${gh.fail}`);
        const pr = prs.get(number)!;
        return { repo, number, ...structuredClone(pr) };
      },
      checkLog: async (_repo: string, c: Check) => {
        gh.logReads++;
        if (gh.logGate) await gh.logGate;
        return `log of ${c.name}`;
      },
      now: () => gh.now,
      wake: (r: any) => {
        gh.woken.push(r.id);
        W_wake(r);
      },
    },
    advance: (ms: number) => (gh.now += ms),
  };
  return gh;
}
let W_wake: (r: any) => void;

const failing = (name: string, sha = 'a'.repeat(40)): PR => ({
  state: 'OPEN',
  headSha: sha,
  checks: [
    { id: `CI / ${name}`, name: `CI / ${name}`, state: 'FAILURE', url: `https://github.com/${REPO}/actions/runs/1/job/2` },
    { id: 'CI / lint', name: 'CI / lint', state: 'SUCCESS', url: null },
  ],
});
const green = (sha = 'a'.repeat(40)): PR => ({ state: 'OPEN', headSha: sha, checks: [{ id: 'CI / build', name: 'CI / build', state: 'SUCCESS', url: null }] });

const watchRequests = (threadId: string) => H.db.messageRequests.forThread(threadId).filter((r) => r.source === 'pr-watch');
const userTexts = (threadId: string) => H.byKind(threadId, 'user').map((e) => e.p);

async function idleThread(prompt: string) {
  const t = await H.start(prompt);
  await H.untilResults(t.id, 1);
  return t;
}
const watch = (threadId: string, number: number, at: number) => S.prWatches.start(threadId, REPO, number, null, W.BASE_S, new Date(at).toISOString());

beforeAll(async () => {
  H = await startRunner();
  W = await import('../pr-watch/worker.ts');
  S = await import('../pr-watch/store.ts');
  G = await import('../pr-watch/gh.ts');
  app = (await import('../app.ts')).app;
  W_wake = H.runner.wake;
  H.db.channels.update('scratch', { github_repo: REPO });
});

// Each test watches its own PRs: the ones before it stop.
beforeEach(() => {
  W.resetPause();
  for (const w of S.prWatches.all()) S.prWatches.stop(w.thread_id, 'stopped', new Date().toISOString());
});

describe('PR watch', () => {
  it('wakes the thread once for a new failing check, with the head and bounded evidence, and never again for it', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('build the feature');
    gh.prs.set(1, failing('build'));
    watch(t.id, 1, gh.now);

    expect(await W.pollOnce(gh.deps)).toBe(1);
    await H.untilResults(t.id, 2);
    const [req] = watchRequests(t.id);
    expect(req).toMatchObject({ state: 'delivered', kind: 'user', mode: 'queue' });
    expect(req.prompt).toContain(`${REPO}#1, head ${'a'.repeat(40)}`);
    expect(req.prompt).toContain('- CI / build: failure');
    expect(req.prompt).toContain('log of CI / build');
    expect(req.prompt).not.toContain('CI / lint');
    expect(userTexts(t.id).at(-1)).toMatchObject({ source: 'pr-watch', text: '#1 at aaaaaaa. CI failed: CI / build', head_sha: 'a'.repeat(40) });

    // Polled again, unchanged, and replayed after a re-run passed and failed again on the same head: no second wake.
    gh.advance(2 * MIN);
    expect(await W.pollOnce(gh.deps)).toBe(0);
    gh.prs.set(1, green());
    gh.advance(10 * MIN);
    await W.pollOnce(gh.deps);
    gh.prs.set(1, failing('build'));
    gh.advance(10 * MIN);
    expect(await W.pollOnce(gh.deps)).toBe(0);
    expect(watchRequests(t.id)).toHaveLength(1);
    expect(H.byKind(t.id, 'result')).toHaveLength(2);
    expect(S.prWatches.get(t.id)).toMatchObject({ state: 'watching', wakes: 1, checks: { failed: 1, passed: 1, pending: 0 } });
  });

  it('wakes again when the same check fails on a new head', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('fix ci');
    gh.prs.set(2, failing('build', '1'.repeat(40)));
    watch(t.id, 2, gh.now);
    await W.pollOnce(gh.deps);
    await H.untilResults(t.id, 2);

    gh.prs.set(2, failing('build', '2'.repeat(40)));
    gh.advance(2 * MIN);
    expect(await W.pollOnce(gh.deps)).toBe(1);
    await H.untilResults(t.id, 3);
    expect(watchRequests(t.id).map((r) => r.payload?.head_sha)).toEqual(['2'.repeat(40), '1'.repeat(40)]);
  });

  it('shares one read per PR between the threads that watch it, and wakes each of them', T, async () => {
    const gh = fakeGitHub();
    const a = await idleThread('first watcher');
    const b = await idleThread('second watcher');
    gh.prs.set(3, failing('test'));
    watch(a.id, 3, gh.now);
    watch(b.id, 3, gh.now);
    expect(await W.pollOnce(gh.deps)).toBe(2);
    expect(gh.reads).toBe(1);
    await H.untilResults(a.id, 2);
    await H.untilResults(b.id, 2);
    // Each stops on its own.
    S.prWatches.stop(a.id, 'stopped', new Date(gh.now).toISOString());
    expect(S.prWatches.get(b.id)?.state).toBe('watching');
  });

  it('costs no read until a watch is due, and polls less often while nothing changes', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('quiet pr');
    gh.prs.set(4, green());
    watch(t.id, 4, gh.now);
    await W.pollOnce(gh.deps);
    expect(gh.reads).toBe(1);
    await W.pollOnce(gh.deps);
    expect(gh.reads).toBe(1);
    const intervals: number[] = [];
    for (let i = 0; i < 6; i++) {
      const w = S.prWatches.get(t.id)!;
      gh.now = Date.parse(w.next_poll_at!);
      await W.pollOnce(gh.deps);
      intervals.push(S.prWatches.get(t.id)!.interval_s);
    }
    expect(intervals).toEqual([120, 240, 480, 900, 900, 900]);
    expect(watchRequests(t.id)).toHaveLength(0);
  });

  it('waits out a rate limit without spending the failure budget, and stops after failures in a row', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('rate limited');
    gh.prs.set(5, failing('build'));
    watch(t.id, 5, gh.now);

    gh.fail = 'HTTP 403: API rate limit exceeded for user ID 1.';
    await W.pollOnce(gh.deps);
    expect(S.prWatches.get(t.id)).toMatchObject({ state: 'watching', failures: 0, error: expect.stringMatching(/rate limit/) });
    gh.advance(5 * MIN);
    await W.pollOnce(gh.deps);
    expect(gh.reads).toBe(1);

    gh.fail = 'HTTP 502: Bad Gateway';
    const waits: number[] = [];
    for (let i = 0; i < W.MAX_FAILURES; i++) {
      gh.now = Math.max(gh.now + 15 * MIN, Date.parse(S.prWatches.get(t.id)!.next_poll_at ?? '0'));
      const before = gh.now;
      await W.pollOnce(gh.deps);
      const w = S.prWatches.get(t.id)!;
      if (w.next_poll_at) waits.push((Date.parse(w.next_poll_at) - before) / 1000);
    }
    expect(waits).toEqual([120, 240, 480, 960]);
    expect(S.prWatches.get(t.id)).toMatchObject({ state: 'stopped', stop_reason: 'error_limit', error: 'HTTP 502: Bad Gateway' });
    expect(watchRequests(t.id)).toHaveLength(0);
  });

  it('keeps a wake saved before a restart for Resume, and a poll after it does not wake twice', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('restart me');
    gh.prs.set(6, failing('build'));
    watch(t.id, 6, gh.now);
    // The server dies after the wake is saved and before the runner gets it.
    const crashed = { ...gh.deps, wake: () => {} };
    await W.pollOnce(crashed);
    expect(watchRequests(t.id)[0].state).toBe('accepted');
    H.db.messageRequests.recover(H.db.outbox.machineId());

    const held = H.runner.pendingFor(t.id).find((p) => p.source === 'pr-watch');
    expect(held).toMatchObject({ state: 'held', delivery: 'recovered', text: '#6 at aaaaaaa. CI failed: CI / build' });

    gh.advance(2 * MIN);
    expect(await W.pollOnce(gh.deps)).toBe(0);
    expect(watchRequests(t.id)).toHaveLength(1);
    await H.runner.resumeRequests(t.id);
    await H.untilResults(t.id, 2);
    expect(watchRequests(t.id)[0].state).toBe('delivered');
    expect(H.byKind(t.id, 'result')).toHaveLength(2);
  });

  it('wakes nobody once the watch is stopped, even mid-poll, or once its thread is archived', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('stop me');
    gh.prs.set(7, failing('build'));
    watch(t.id, 7, gh.now);
    let open!: () => void;
    gh.logGate = new Promise((r) => (open = r));
    const poll = W.pollOnce(gh.deps);
    await H.until('evidence read started', () => gh.logReads > 0);
    S.prWatches.stop(t.id, 'stopped', new Date(gh.now).toISOString());
    open();
    expect(await poll).toBe(0);
    expect(watchRequests(t.id)).toHaveLength(0);
    gh.advance(2 * MIN);
    await W.pollOnce(gh.deps);
    expect(gh.reads).toBe(1);

    const u = await idleThread('archive me');
    gh.logGate = null;
    gh.prs.set(8, failing('build'));
    watch(u.id, 8, gh.now);
    H.db.threads.update(u.id, { archived: 1 } as any);
    await W.pollOnce(gh.deps);
    expect(S.prWatches.get(u.id)).toMatchObject({ state: 'stopped', stop_reason: 'archived' });
    expect(watchRequests(u.id)).toHaveLength(0);
  });

  it('ends when the PR merges or closes', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('merge me');
    gh.prs.set(9, { ...failing('build'), state: 'MERGED' });
    watch(t.id, 9, gh.now);
    await W.pollOnce(gh.deps);
    expect(S.prWatches.get(t.id)).toMatchObject({ state: 'stopped', stop_reason: 'merged' });
    expect(watchRequests(t.id)).toHaveLength(0);
  });

  it('stops itself at its wake limit', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('loop');
    watch(t.id, 10, gh.now);
    for (let i = 1; i <= S.MAX_WAKES; i++) {
      gh.prs.set(10, failing('build', String(i).repeat(40)));
      gh.advance(2 * MIN);
      await W.pollOnce(gh.deps);
      await H.untilResults(t.id, i + 1);
    }
    expect(S.prWatches.get(t.id)).toMatchObject({ state: 'stopped', stop_reason: 'wake_limit', wakes: S.MAX_WAKES });
    gh.prs.set(10, failing('build', 'f'.repeat(40)));
    gh.advance(2 * MIN);
    await W.pollOnce(gh.deps);
    expect(watchRequests(t.id)).toHaveLength(S.MAX_WAKES);
  });

  it('holds the wake for Resume when this Mac cannot start a turn in the thread', T, async () => {
    const gh = fakeGitHub();
    const t = await idleThread('not ready here');
    gh.prs.set(11, failing('build'));
    watch(t.id, 11, gh.now);
    H.db.threads.update(t.id, { setup: 'failed', setup_error: 'no worktree' } as any);
    await W.pollOnce(gh.deps);
    expect(gh.woken).toEqual([]);
    expect(watchRequests(t.id)[0].state).toBe('recovered');
    expect(H.byKind(t.id, 'result')).toHaveLength(1);
  });
});

describe('PR watch API', () => {
  it('starts, reads and stops a watch, and refuses a thread it cannot watch', T, async () => {
    const t = await idleThread('api');
    const call = async (method: string, body?: unknown) => {
      const res = await app.request(`/api/threads/${t.id}/pr-watch`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    expect(await call('GET')).toEqual({ status: 200, body: null });
    // No branch, so no PR of its own to find.
    expect(await call('PUT', {})).toMatchObject({ status: 409, body: { error: expect.stringMatching(/no PR to watch/) } });
    const started = await call('PUT', { number: 12 });
    expect(started).toMatchObject({ status: 200, body: { thread_id: t.id, repo: REPO, number: 12, state: 'watching', wakes: 0, max_wakes: S.MAX_WAKES } });
    expect(started.body).not.toHaveProperty('failures');
    expect((await call('GET')).body).toMatchObject({ state: 'watching' });
    expect((await call('DELETE')).body).toMatchObject({ state: 'stopped', stop_reason: 'stopped' });
    const list = await (await app.request('/api/pr-watches')).json();
    expect(list.find((w: any) => w.thread_id === t.id)).toMatchObject({ state: 'stopped' });
  });
});

describe('logTail', () => {
  it('keeps the last lines of a failing log, without gh columns or timestamps, cut to size', () => {
    const log = Array.from({ length: 100 }, (_, i) => `build\tRun tests\t2026-10-24T10:00:${String(i % 60).padStart(2, '0')}.1234567Z line ${i}`).join('\n');
    const tail = G.logTail(log)!;
    expect(tail.split('\n')).toHaveLength(40);
    expect(tail.split('\n')[0]).toBe('line 60');
    expect(G.logTail('x\t'.repeat(10) + 'y'.repeat(5000), 40, 3000)!.length).toBeLessThanOrEqual(3000);
    expect(G.logTail('')).toBeNull();
  });

  it('reads a check from gh JSON, by workflow and job name', () => {
    const obs = G.parseObservation(REPO, {
      number: 1,
      state: 'OPEN',
      headRefOid: 'abc',
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'build', workflowName: 'CI', conclusion: 'FAILURE', status: 'COMPLETED', detailsUrl: 'u' },
        { __typename: 'StatusContext', context: 'vercel', state: 'PENDING', targetUrl: 'v' },
      ],
    });
    expect(obs.checks).toEqual([
      { id: 'CI / build', name: 'CI / build', state: 'FAILURE', url: 'u' },
      { id: 'vercel', name: 'vercel', state: 'PENDING', url: 'v' },
    ]);
  });
});
