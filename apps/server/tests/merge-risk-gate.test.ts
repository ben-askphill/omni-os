import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { GateDeps, OpenPR, PRText } from '../merge-risk/gate.ts';

// The merge-risk gate's poll against a real db, with GitHub, main's rubric and the model faked: which PRs it rates,
// that it rates a head once, rates a new push again, writes "not rated" after failed runs, and never writes a rating
// for a head that moved. The last block runs the real gh writes against a fake gh, to show a rerun edits the one
// comment and swaps the label instead of adding more.

const tmp = mkdtempSync(join(tmpdir(), 'omni-merge-risk-gate-'));
const REPO = 'o/omni';
let db: typeof import('../db.ts');
let gate: typeof import('../merge-risk/gate.ts');

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = join(tmp, 'data');
  // The needs label comes from the name in Settings > General.
  mkdirSync(join(tmp, 'data'), { recursive: true });
  writeFileSync(join(tmp, 'data', 'omni.config.json'), JSON.stringify({ version: 1, user: { name: 'Ben' } }));
  db = await import('../db.ts');
  gate = await import('../merge-risk/gate.ts');
  const checkout = join(tmp, 'checkout');
  mkdirSync(checkout);
  db.channels.create({ id: 'omni-os', name: 'omni-os', kind: 'internal', github_repo: REPO, repo_path: checkout });
});

let n = 0;
const thread = (branch: string, extra: Partial<import('../db.ts').Thread> = {}) => {
  const id = `t-${++n}`;
  return db.threads.create({
    id, channel_id: 'omni-os', title: id, status: 'done', role: 'builder', model: null, session_id: id, cwd: '/tmp',
    branch, parent_id: null, task_id: null, source: 'conductor', automation: null, ...extra,
  });
};

const ALL_GOOD = '**Merge risk: low**';
const ONE_DECENT = '**Merge risk: low**\n\n- **Impact:** 👀 touches apps/server/sync/';

interface World {
  open: OpenPR[];
  /** The head GitHub reports when the gate checks just before writing. Defaults to the listed head. */
  headNow: Record<number, string>;
  replies: (string | null)[];
  prompts: string[];
  published: { n: number; body: string; label: string; other: string }[];
  unlabelled: { n: number; label: string }[];
  rubric: string | null;
  here: boolean;
}
let w: World;
const pr = (number: number, headRefName: string, headRefOid: string, over: Partial<OpenPR> = {}): OpenPR => ({ number, headRefName, headRefOid, isDraft: false, isCrossRepository: false, ...over });
const deps: GateDeps = {
  repo: () => REPO,
  here: () => w.here,
  needs: () => gate.ghDeps.needs(),
  listOpen: async () => w.open,
  readPR: async (_repo, num): Promise<PRText> => {
    const p = w.open.find((x) => x.number === num)!;
    return { title: `PR ${num}`, body: 'Does the thing.', diff: `diff --git a/x b/x\n+${num}`, headRefName: p.headRefName, headRefOid: p.headRefOid };
  },
  head: async (_repo, num) => ({ headRefOid: w.headNow[num] ?? w.open.find((x) => x.number === num)!.headRefOid, state: 'OPEN' }),
  rubric: async () => (w.rubric === null ? null : { text: w.rubric, sha: 'r'.repeat(40), ref: 'origin/main' }),
  rate: async (prompt) => {
    w.prompts.push(prompt);
    return w.replies.length ? w.replies.shift()! : ALL_GOOD;
  },
  publish: async (_repo, num, body, label, other) => void w.published.push({ n: num, body, label, other }),
  unlabel: async (_repo, num, label) => void w.unlabelled.push({ n: num, label }),
};
const poll = () => gate.pollOnce(deps);

beforeEach(() => {
  w = { open: [], headNow: {}, replies: [], prompts: [], published: [], unlabelled: [], rubric: 'RUBRIC FROM MAIN', here: true };
  for (const [key] of db.kv.list('merge-risk:')) db.kv.delete(key);
});

describe('which PRs the gate rates', () => {
  it("rates an open builder PR with main's rubric and the PR as data, and labels an omni/ branch with every area good merge-ready", async () => {
    thread('omni/aaaa1111');
    w.open = [pr(1, 'omni/aaaa1111', 'a1')];
    expect(await poll()).toBe(1);
    expect(w.prompts).toHaveLength(1);
    expect(w.prompts[0]).toContain('RUBRIC FROM MAIN');
    expect(w.prompts[0]).toContain('# Pull request o/omni#1 at a1');
    expect(w.prompts[0]).toMatch(/Title:\n```\nPR 1\n```/);
    expect(w.published).toEqual([{ n: 1, label: 'merge-ready', other: 'needs-ben', body: expect.stringContaining('**Merge risk: low**') }]);
  });

  it("labels a low rating with one decent area needs-ben, from Ben's name, with the bullet in the comment", async () => {
    thread('omni/bbbb2222');
    w.open = [pr(2, 'omni/bbbb2222', 'b1')];
    w.replies = [ONE_DECENT];
    await poll();
    expect(w.published[0]).toMatchObject({ label: 'needs-ben', other: 'merge-ready' });
    expect(w.published[0].body).toContain('**Merge risk: low**\n\n- **Impact:** 👀 touches apps/server/sync/');
  });

  it('labels a builder branch outside omni/ needs-ben, and writes the level code set, not the one the model wrote', async () => {
    thread('fix/own-branch');
    w.open = [pr(3, 'fix/own-branch', 'c1')];
    w.replies = ['**Merge risk: low**\n- **Impact:** ⚠️ relay\n- **Verification:** ⚠️ none\n- **Rollback cost:** ⚠️ migration'];
    await poll();
    expect(w.published[0]).toMatchObject({ label: 'needs-ben', body: expect.stringContaining('**Merge risk: high**') });
  });

  it("skips drafts, forks, PRs no builder opened and a builder that is still working, and rates the last once it stops", async () => {
    const working = thread('omni/dddd4444', { status: 'running' });
    thread('omni/eeee5555', { role: 'researcher' });
    thread('omni/ffff6666');
    thread('omni/gggg7777');
    w.open = [
      pr(4, 'omni/dddd4444', 'd1'),
      pr(5, 'omni/eeee5555', 'e1'),
      pr(6, 'omni/ffff6666', 'f1', { isDraft: true }),
      pr(7, 'omni/gggg7777', 'g1', { isCrossRepository: true }),
      pr(8, 'someone-else', 'h1'),
    ];
    expect(await poll()).toBe(0);
    expect(w.prompts).toHaveLength(0);
    db.threads.update(working.id, { status: 'done' });
    expect(await poll()).toBe(1);
    expect(w.published.map((p) => p.n)).toEqual([4]);
  });

  it('rates nothing when main has no rubric, or when another machine runs the automations', async () => {
    thread('omni/iiii9999');
    w.open = [pr(9, 'omni/iiii9999', 'i1')];
    w.rubric = null;
    expect(await poll()).toBe(0);
    w.rubric = 'RUBRIC';
    w.here = false;
    expect(await poll()).toBe(0);
    expect(w.prompts).toHaveLength(0);
  });
});

describe('reruns', () => {
  it('rates a head once, rates a new push again, and takes merge-ready off before rating it', async () => {
    thread('omni/jjjj1010');
    w.open = [pr(10, 'omni/jjjj1010', 'j1')];
    await poll();
    await poll();
    expect(w.prompts).toHaveLength(1);
    expect(w.published).toHaveLength(1);
    w.open = [pr(10, 'omni/jjjj1010', 'j2')];
    w.replies = [ONE_DECENT];
    await poll();
    expect(w.unlabelled).toEqual([{ n: 10, label: 'merge-ready' }]);
    expect(w.published.map((p) => p.label)).toEqual(['merge-ready', 'needs-ben']);
    expect(w.published[1].body).toContain('Omni rated j2');
    expect(db.kv.get(gate.markKey(REPO, 10))).toMatchObject({ sha: 'j2', posted: { label: 'needs-ben', level: 'low' } });
  });

  it('takes merge-ready off as soon as a push lands, while the builder is still working, and rates it once the turn ends', async () => {
    const builder = thread('omni/oooo1515');
    w.open = [pr(15, 'omni/oooo1515', 'o1')];
    await poll();
    expect(w.published.map((p) => p.label)).toEqual(['merge-ready']);
    db.threads.update(builder.id, { status: 'running' });
    w.open = [pr(15, 'omni/oooo1515', 'o2')];
    expect(await poll()).toBe(0);
    expect(w.unlabelled).toEqual([{ n: 15, label: 'merge-ready' }]);
    expect(w.prompts).toHaveLength(1);
    await poll();
    expect(w.unlabelled).toHaveLength(1);
    db.threads.update(builder.id, { status: 'done' });
    expect(await poll()).toBe(1);
    expect(w.published[1].body).toContain('Omni rated o2');
  });

  it("fetches main's rubric only when a PR needs rating", async () => {
    thread('omni/pppp1616');
    w.open = [pr(16, 'omni/pppp1616', 'p1')];
    let reads = 0;
    const rubric = deps.rubric;
    deps.rubric = async (c) => (reads++, rubric(c));
    try {
      await poll();
      await poll();
      await poll();
    } finally {
      deps.rubric = rubric;
    }
    expect(reads).toBe(1);
  });

  it('does not write a rating for a head that moved while the model read it, and rates the new head next', async () => {
    thread('omni/kkkk1111');
    w.open = [pr(11, 'omni/kkkk1111', 'k1')];
    w.headNow[11] = 'k2';
    expect(await poll()).toBe(0);
    expect(w.published).toHaveLength(0);
    w.open = [pr(11, 'omni/kkkk1111', 'k2')];
    expect(await poll()).toBe(1);
    expect(w.published[0].body).toContain('Omni rated k2');
    expect(w.prompts).toHaveLength(2);
  });

  it('tries a failed run again, then writes "not rated" with needs-ben after the second', async () => {
    thread('omni/llll1212');
    w.open = [pr(12, 'omni/llll1212', 'l1')];
    w.replies = [null, 'I think this PR is fine.'];
    expect(await poll()).toBe(0);
    expect(await poll()).toBe(1);
    expect(w.published).toEqual([{ n: 12, label: 'needs-ben', other: 'merge-ready', body: expect.stringContaining('**Merge risk: not rated**') }]);
    expect(w.published[0].body).toContain("did not follow the rubric's format");
    await poll();
    expect(w.prompts).toHaveLength(2);
  });

  it('writes a finished rating again without another run when the write failed', async () => {
    thread('omni/mmmm1313');
    w.open = [pr(13, 'omni/mmmm1313', 'm1')];
    const publish = deps.publish;
    deps.publish = async () => {
      throw new Error('HTTP 502');
    };
    try {
      expect(await poll()).toBe(0);
    } finally {
      deps.publish = publish;
    }
    expect(await poll()).toBe(1);
    expect(w.prompts).toHaveLength(1);
  });

  it('forgets PRs that are no longer open', async () => {
    thread('omni/nnnn1414');
    w.open = [pr(14, 'omni/nnnn1414', 'n1')];
    await poll();
    expect(db.kv.get(gate.markKey(REPO, 14))).toBeTruthy();
    w.open = [];
    await poll();
    expect(db.kv.get(gate.markKey(REPO, 14))).toBeUndefined();
  });
});

describe('writing to GitHub', () => {
  // A gh on PATH that logs each call and keeps the PR's comments and labels, so the real publish runs end to end.
  const bin = join(tmp, 'bin');
  const state = join(tmp, 'gh-state.json');
  const log = join(tmp, 'gh-log.jsonl');
  beforeAll(() => {
    mkdirSync(bin, { recursive: true });
    writeFileSync(state, JSON.stringify({ comments: [{ id: 7, user: 'someone', body: 'LGTM' }], labels: ['bug'], nextId: 100 }));
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(s));
const field = (k) => { const i = args.findIndex((a, j) => args[j - 1] === '-f' && a.startsWith(k + '=')); return i < 0 ? null : args[i].slice(k.length + 1); };
const path = args.find((a) => a.startsWith('repos/'));
const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : (args.some((a) => a === '-f') ? 'POST' : 'GET');
if (args[0] === 'api' && args[1] === 'user') { console.log('omni-bot'); process.exit(0); }
if (/\\/issues\\/\\d+\\/comments$/.test(path) && method === 'GET') {
  for (const c of s.comments) if (c.body.includes('<!-- omni-merge-risk -->')) console.log(JSON.stringify({ id: c.id, login: c.user }));
  process.exit(0);
}
if (/\\/issues\\/\\d+\\/comments$/.test(path)) { s.comments.push({ id: s.nextId++, user: 'omni-bot', body: field('body') }); save(); process.exit(0); }
if (/\\/issues\\/comments\\/\\d+$/.test(path) && method === 'PATCH') { const id = Number(path.split('/').pop()); s.comments.find((c) => c.id === id).body = field('body'); save(); process.exit(0); }
if (/\\/labels$/.test(path) && path.includes('/issues/')) { const l = field('labels[]'); if (!s.labels.includes(l)) s.labels.push(l); save(); process.exit(0); }
if (/\\/issues\\/\\d+\\/labels\\/.+$/.test(path) && method === 'DELETE') {
  const l = decodeURIComponent(path.split('/').pop());
  if (!s.labels.includes(l)) { console.error('gh: Label does not exist (HTTP 404)'); process.exit(1); }
  s.labels = s.labels.filter((x) => x !== l); save(); process.exit(0);
}
if (/\\/labels$/.test(path)) process.exit(0);
console.error('fake gh: unexpected ' + args.join(' ')); process.exit(1);
`,
    );
    chmodSync(join(bin, 'gh'), 0o755);
    process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  });
  const gh = () => JSON.parse(readFileSync(state, 'utf8')) as { comments: { id: number; user: string; body: string }[]; labels: string[] };

  it('adds one comment and the label, then edits that comment and swaps the label on a rerun', async () => {
    await gate.ghDeps.publish(REPO, 20, '<!-- omni-merge-risk -->\n**Merge risk: low**', 'merge-ready', 'needs-ben');
    expect(gh().comments.map((c) => c.id)).toEqual([7, 100]);
    expect(gh().labels).toEqual(['bug', 'merge-ready']);
    await gate.ghDeps.publish(REPO, 20, '<!-- omni-merge-risk -->\n**Merge risk: medium**\n\n- **Impact:** 👀 sync', 'needs-ben', 'merge-ready');
    expect(gh().comments).toEqual([
      { id: 7, user: 'someone', body: 'LGTM' },
      { id: 100, user: 'omni-bot', body: '<!-- omni-merge-risk -->\n**Merge risk: medium**\n\n- **Impact:** 👀 sync' },
    ]);
    expect(gh().labels).toEqual(['bug', 'needs-ben']);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
    expect(calls.filter((a) => a.includes('PATCH'))).toHaveLength(1);
    expect(calls.filter((a) => a.includes('repos/o/omni/issues/20/comments') && a.some((x) => x.startsWith('body=')))).toHaveLength(1);
  });

  it("does not edit someone else's comment that carries the marker", async () => {
    const s = gh();
    s.comments = [{ id: 8, user: 'mallory', body: '<!-- omni-merge-risk -->\nfake' }];
    writeFileSync(state, JSON.stringify({ ...s, nextId: 200 }));
    await gate.ghDeps.publish(REPO, 21, '<!-- omni-merge-risk -->\n**Merge risk: low**', 'merge-ready', 'needs-ben');
    expect(gh().comments.map((c) => [c.id, c.user])).toEqual([
      [8, 'mallory'],
      [200, 'omni-bot'],
    ]);
  });
});
