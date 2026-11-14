import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// POST /api/channels/:id/prs/:n/rerun-failed: `gh run rerun --failed` once per workflow run behind the PR's failing
// checks, against a fake gh that answers from a file and logs each rerun.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: (typeof import('../app.ts'))['app'];
let rollupFile: string;
let logFile: string;

const job = (name: string, conclusion: string, run: number, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, conclusion, status, detailsUrl: `https://github.com/acme/shop/actions/runs/${run}/job/${run}1` });
/** What `gh pr view N --json statusCheckRollup` answers, per PR number. */
const rollups = (byPR: Record<number, unknown[]>) => {
  writeFileSync(rollupFile, JSON.stringify(byPR));
  writeFileSync(logFile, '');
};
const reruns = () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
const rerun = (n: number, channel = 'shop') => app.request(`/api/channels/${channel}/prs/${n}/rerun-failed`, { method: 'POST' });

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  rollupFile = join(H.tmp, 'gh-rollups.json');
  logFile = join(H.tmp, 'gh-reruns.log');
  rollups({});
  // Run 900 answers as gh does for a run GitHub will not rerun.
  const gh = `#!/usr/bin/env node
const fs = require('fs'), a = process.argv.slice(2);
if (a[0] === 'pr' && a[1] === 'view' && a.includes('statusCheckRollup')) {
  const r = JSON.parse(fs.readFileSync(${JSON.stringify(rollupFile)}, 'utf8'))[a[2]];
  if (!r) { console.error('no pull requests found'); process.exit(1); }
  console.log(JSON.stringify({ statusCheckRollup: r })); process.exit(0);
}
if (a[0] === 'run' && a[1] === 'rerun') {
  fs.appendFileSync(${JSON.stringify(logFile)}, a.join(' ') + '\\n');
  if (a[2] === '900') { console.error('run 900 cannot be rerun; its workflow file may be broken'); process.exit(1); }
  console.log('Requested rerun (failed jobs) of run ' + a[2]); process.exit(0);
}
console.error('fake gh: ' + a.join(' ')); process.exit(1);
`;
  writeFileSync(join(H.tmp, 'bin', 'gh'), gh, { mode: 0o755 });
  H.db.channels.create({ id: 'shop', name: 'shop', github_repo: 'acme/shop' });
  H.db.channels.create({ id: 'norepo', name: 'norepo' });
});

describe('POST /channels/:id/prs/:n/rerun-failed', () => {
  it('reruns each failing workflow run once, and leaves passing, running and non-Actions checks alone', async () => {
    rollups({
      12: [
        job('lint', 'SUCCESS', 100),
        job('unit', 'FAILURE', 200),
        job('e2e', 'TIMED_OUT', 200),
        job('deploy', 'CANCELLED', 300),
        job('build', '', 400, 'IN_PROGRESS'),
        { __typename: 'StatusContext', context: 'vercel', state: 'FAILURE', targetUrl: 'https://vercel.com/acme/shop/abc' },
      ],
    });
    const res = await rerun(12);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [{ id: '200', ok: true }, { id: '300', ok: true }], skipped: 1 });
    expect(reruns().sort()).toEqual(['run rerun 200 --failed --repo acme/shop', 'run rerun 300 --failed --repo acme/shop']);
  });

  it("answers each run's outcome when only some start again", async () => {
    rollups({ 13: [job('unit', 'FAILURE', 200), job('docs', 'FAILURE', 900)] });
    const res = await rerun(13);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: [{ id: '200', ok: true }, { id: '900', ok: false, error: 'run 900 cannot be rerun; its workflow file may be broken' }],
      skipped: 0,
    });
  });

  it("refuses with gh's message when no run starts again", async () => {
    rollups({ 14: [job('docs', 'FAILURE', 900)] });
    const res = await rerun(14);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'run 900 cannot be rerun; its workflow file may be broken' });
  });

  it('refuses when nothing failed, or nothing failing is a workflow run, and runs nothing', async () => {
    rollups({ 15: [job('lint', 'SUCCESS', 100)], 16: [{ __typename: 'StatusContext', context: 'vercel', state: 'ERROR', targetUrl: 'https://vercel.com/x' }] });
    const none = await rerun(15);
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: 'No checks are failing.' });
    const other = await rerun(16);
    expect(other.status).toBe(409);
    expect((await other.json()).error).toContain('None of the failing checks is a GitHub Actions run');
    expect(reruns()).toEqual([]);
  });

  it('refuses a channel with no GitHub repo', async () => {
    const res = await rerun(12, 'norepo');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'channel has no GitHub repo set' });
  });
});
