import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// Plan slice S4: capabilities and the roles Omni relies on. The `review` flag in place of the reviewer's id, the locks
// on the Conductor, usage-scan and reviewer, `review_of` picking the other model family for a review, and the Review PR
// action's builder. The shipped files are the test's own, so nothing reads or writes the repo's crew/.

const H = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-caps-home-')), OMNI_CODEX_BIN: FAKE_CODEX });
await (await import('../harness/catalog-service.ts')).loadCatalog();
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');
const { getCrew } = await import('../crew.ts');
const { getCatalog } = await import('../harness/catalog-service.ts');
const { modelFamily, REVIEW_RUNS, reviewRun } = await import('../harness/review.ts');
const { requestPRReview } = await import('../pr-review.ts');

const shipped = mkdtempSync(join(tmpdir(), 'omni-caps-shipped-'));
paths.crew = shipped;
const ship = (id: string, text: string) => writeFileSync(join(shipped, `${id}.md`), text);
ship('conductor', '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
ship('usage-scan', '---\nname: Usage scan\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nScan.\n');
ship('reviewer', '---\nname: Reviewer\nmodel: auto\nreview: true\n---\nReview the PR.\n');
ship('builder', '---\nname: Builder\nmodel: auto\n---\nShip code.\n');

const send = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;
const refusal = async (res: Response) => ({ status: res.status, error: (await json(res)).error as string });

describe('the locks on the roles Omni relies on', () => {
  it('keeps the Conductor routing, delegating and out of delegation, and lets its charter grow', async () => {
    expect(await refusal(await send('PUT', '/crew/conductor', { fields: { delegatable: true } }))).toEqual({
      status: 409,
      error: 'Nothing delegates to the Conductor: it is the one that delegates. Leave delegatable as the built-in has it.',
    });
    expect((await send('PUT', '/crew/conductor', { fields: { mcp: [] } })).status).toBe(409);
    expect((await send('PUT', '/crew/conductor', { fields: { delegate_only: false } })).status).toBe(409);
    // The markdown tab is held to the same rules.
    expect((await send('PUT', '/crew/conductor', { markdown: '---\ndelegatable: true\n---\n' })).status).toBe(409);
    // A remote runtime gets no delegate tools, so a router there would never start.
    expect(await refusal(await send('PUT', '/crew/conductor', { fields: { harness: 'hermes' } }))).toMatchObject({ status: 409, error: expect.stringMatching(/^Conductor only routes work, with Omni's delegate tools/) });
    expect((await send('PUT', '/crew/conductor', { charter: 'Reply in Dutch.' })).status).toBe(200);
    expect(getCrew('conductor')?.charter).toBe('Route everything.\n\nReply in Dutch.');
    await send('POST', '/crew/conductor/reset');
  });

  it("only adds to usage-scan's charter", async () => {
    expect(await refusal(await send('PUT', '/crew/usage-scan', { charter: 'Mine.', charter_mode: 'replace' }))).toEqual({
      status: 409,
      error: "Add to the built-in only: the scan's steps come with each release. Save your text as an addition (charter_mode: append).",
    });
    expect((await send('PUT', '/crew/usage-scan', { markdown: '---\ncharter_mode: replace\n---\nMine.\n' })).status).toBe(409);
    // An overlay with no mode is a replacement, as a hand copy is.
    expect((await send('PUT', '/crew/usage-scan', { markdown: '---\n---\nMine.\n' })).status).toBe(409);
    expect((await send('PUT', '/crew/usage-scan', { fields: { delegatable: true } })).status).toBe(409);
    expect((await send('PUT', '/crew/usage-scan', { charter: 'Three at most.' })).status).toBe(200);
    expect(getCrew('usage-scan')).toMatchObject({ charter: 'Scan.\n\nThree at most.', charterMode: 'append' });
    await send('POST', '/crew/usage-scan/reset');
  });

  it("keeps the reviewer's review capability on", async () => {
    expect(await refusal(await send('PUT', '/crew/reviewer', { fields: { review: false } }))).toEqual({
      status: 409,
      error: "Omni's review rules come with this role. Duplicate it for a reviewer without them. Leave review as the built-in has it.",
    });
    // Its other fields are the user's.
    expect((await send('PUT', '/crew/reviewer', { fields: { model: 'opus' } })).status).toBe(200);
    await send('POST', '/crew/reviewer/reset');
  });

  it('refuses a duplicate of the singletons and hiding them, with why, and copies the reviewer with its capability', async () => {
    expect(await refusal(await send('POST', '/crew/conductor/duplicate', { id: 'conductor-two' }))).toEqual({
      status: 409,
      error: 'The Conductor is not duplicated: there is one. Make another role with New role.',
    });
    expect((await send('POST', '/crew/usage-scan/duplicate', { id: 'scan-two' })).status).toBe(409);
    expect(await refusal(await send('POST', '/crew/conductor/hidden', { hidden: true }))).toEqual({ status: 409, error: 'The Conductor is never hidden: it is the front agent in #conductor.' });

    const res = await send('POST', '/crew/reviewer/duplicate', { id: 'security-review', name: 'Security review' });
    expect(res.status).toBe(201);
    const copy = (await json(res)).role;
    expect(copy).toMatchObject({ kind: 'own', review: true });
    // A role of the user's own is not locked: its review rules are theirs to turn off.
    expect(copy.locks).toBeUndefined();
    expect((await json(await send('PUT', '/crew/security-review', { fields: { review: null } }))).role.review).toBe(false);
    await send('DELETE', '/crew/security-review');
  });

  it('sends the locks with the role, so Settings can say why', async () => {
    const list = (await json(await send('GET', '/crew?all=1'))) as any[];
    const by = Object.fromEntries(list.map((r) => [r.id, r]));
    expect(Object.keys(by.conductor.locks.fields).sort()).toEqual(['delegatable', 'delegate_only', 'mcp']);
    expect(Object.keys(by.conductor.locks.actions).sort()).toEqual(['duplicate', 'hide']);
    expect(Object.keys(by['usage-scan'].locks.fields).sort()).toEqual(['charter_mode', 'delegatable', 'delegate_only', 'mcp']);
    expect(by.reviewer.locks).toEqual({ fields: { review: expect.any(String) } });
    expect(by.builder.locks).toBeUndefined();
    expect([by.reviewer.review, by.builder.review]).toEqual([true, false]);
    expect((await json(await send('GET', '/crew/reviewer'))).role.locks.fields.review).toMatch(/^Omni's review rules/);
  });
});

describe('the review capability', () => {
  it('holds any review role on GPT at high effort, by the flag and not the id', async () => {
    expect((await send('POST', '/crew', { id: 'audit', fields: { name: 'Audit', review: true }, charter: 'Audit it.' })).status).toBe(201);
    const audit = await H.runner.createThread({ channel: 'scratch', prompt: 'x', role: 'audit', harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
    expect(audit.effort).toBe('high');
    const builder = await H.runner.createThread({ channel: 'scratch', prompt: 'x', role: 'builder', harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
    expect(builder.effort).toBe('xhigh');
    await send('DELETE', '/crew/audit');
  });
});

describe('a lock against a file written by hand', () => {
  const writeOwn = (id: string, text: string) => {
    mkdirSync(paths.personalCrew, { recursive: true });
    writeFileSync(join(paths.personalCrew, `${id}.md`), text);
  };

  it("loads each built-in Omni relies on with its locks, whatever its overlay says, and keeps the overlay's other edits", async () => {
    try {
      writeOwn('reviewer', '---\nreview: false\ndescription: Reviews with care.\n---\nMy review steps.\n');
      expect(getCrew('reviewer')).toMatchObject({ review: true, description: 'Reviews with care.', charter: 'My review steps.' });

      writeOwn('conductor', '---\ndelegate_only: false\nmcp: []\ndelegatable: true\nmodel: opus\ncharter_mode: append\n---\nAsk before you merge.\n');
      expect(getCrew('conductor')).toMatchObject({ delegateOnly: true, mcp: ['omni'], delegatable: false, model: 'opus', charter: 'Route everything.\n\nAsk before you merge.' });
      // `tools:` cannot lift delegate-only either, alone or beside delegate_only: false.
      writeOwn('conductor', '---\ntools: full\ncharter_mode: append\n---\n');
      expect(getCrew('conductor')).toMatchObject({ tools: 'delegate-only', delegateOnly: true });
      writeOwn('conductor', '---\ndelegate_only: false\ntools: no-edits\ncharter_mode: append\n---\n');
      expect(getCrew('conductor')).toMatchObject({ tools: 'delegate-only', delegateOnly: true });

      // Usage scan's steps come with each release: a replacing overlay is read as an addition.
      writeOwn('usage-scan', '---\ndelegate_only: false\n---\nAlso look at cron jobs.\n');
      expect(getCrew('usage-scan')).toMatchObject({ delegateOnly: true, charterMode: 'append', charter: 'Scan.\n\nAlso look at cron jobs.' });
      expect((await json(await send('GET', '/crew/usage-scan'))).charters.effective).toBe('Scan.\n\nAlso look at cron jobs.');

      // A review delegation still finds the reviewer.
      expect((await json(await send('GET', '/crew?all=1'))).filter((r: { review: boolean }) => r.review).map((r: { id: string }) => r.id)).toEqual(['reviewer']);
    } finally {
      for (const id of ['reviewer', 'conductor', 'usage-scan']) rmSync(join(paths.personalCrew, `${id}.md`), { force: true });
    }
  });
});

/** GPT-6.1 Sol, which the fake Codex does not list: a test that reviews on it adds it to the catalog for its run. */
const sol = { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' };
async function withSol<T>(fn: () => Promise<T>): Promise<T> {
  const codex = getCatalog().harnesses.find((h) => h.id === 'codex')!;
  codex.models.push(sol);
  try {
    return await fn();
  } finally {
    codex.models.splice(codex.models.indexOf(sol), 1);
  }
}

describe('review_of', () => {
  it('reviews work Claude wrote on GPT-6.1 Sol at high, and work any other model wrote on Claude at the top tier', async () => {
    expect(REVIEW_RUNS.other).toEqual({ harness: 'codex', model: 'gpt-6.1-sol', effort: 'high' });
    const byClaude = await H.runner.createThread({ channel: 'scratch', prompt: 'build it', role: 'builder', harness: 'claude-code', model: 'sonnet' });
    const review = await withSol(() => H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byClaude.id, source: 'conductor' }));
    expect([review.harness, review.model, review.effort]).toEqual(['codex', 'gpt-6.1-sol', 'high']);

    const byGpt = await H.runner.createThread({ channel: 'scratch', prompt: 'build it', role: 'builder', harness: 'codex', model: 'gpt-5.6-terra' });
    const back = await H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byGpt.id, source: 'conductor' });
    expect([back.harness, back.model, back.effort]).toEqual(['claude-code', 'claude-opus-5-5', 'xhigh']);
  });

  it("refuses a review when Codex here has no GPT-6.1 Sol, rather than run it on Codex's default model", async () => {
    const byClaude = await H.runner.createThread({ channel: 'scratch', prompt: 'build it', role: 'builder', harness: 'claude-code', model: 'sonnet' });
    expect(getCatalog().harnesses.find((h) => h.id === 'codex')?.models.some((m) => m.default)).toBe(true);
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byClaude.id, source: 'conductor' })).rejects.toMatchObject({
      status: 409,
      message: 'This review runs on gpt-6.1-sol at high, and Codex here does not offer gpt-6.1-sol. Omni does not review on another model in its place. Ask the user how to review it.',
    });
    // An effort the delegation names does not move the pinned run either.
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byClaude.id, effort: 'low', source: 'conductor' })).rejects.toMatchObject({ status: 409 });
    // Sol listed without high is refused too, never run at its nearest effort.
    const cat = getCatalog();
    const noHigh = { ...cat, harnesses: cat.harnesses.map((h) => (h.id === 'codex' ? { ...h, models: [...h.models, { ...sol, efforts: ['low', 'medium', 'xhigh'] }] } : h)) };
    expect(reviewRun({}, { id: 't3', harness: 'claude-code', model: 'sonnet' }, noHigh)).toEqual({
      refused: 'This review runs on gpt-6.1-sol at high, and Codex here does not offer high for it. Ask the user how to review it.',
    });
  });

  it('keeps a run on the other family, and refuses the same family, a role that does not review and a thread that is not there', async () => {
    const byClaude = await H.runner.createThread({ channel: 'scratch', prompt: 'build it', role: 'builder', harness: 'claude-code', model: 'sonnet' });
    const named = await H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byClaude.id, harness: 'codex', model: 'gpt-5.6-terra' });
    expect([named.harness, named.model]).toEqual(['codex', 'gpt-5.6-terra']);

    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byClaude.id, harness: 'claude-code', model: 'opus' })).rejects.toMatchObject({
      status: 409,
      message: `Claude wrote thread ${byClaude.id} (Claude Code ${byClaude.model}), so its review runs on the other family. Leave harness, model and effort off and Omni picks it.`,
    });
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: byClaude.id, model: 'auto' })).rejects.toMatchObject({ status: 409 });
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'builder', review_of: byClaude.id })).rejects.toMatchObject({
      status: 400,
      message: 'review_of is for a review role. Review roles: reviewer.',
    });
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'review it', role: 'reviewer', review_of: 'no-such-thread' })).rejects.toMatchObject({ status: 404 });
  });

  it('comes through the thread API as the delegate tool sends it', async () => {
    const byClaude = await H.runner.createThread({ channel: 'scratch', prompt: 'build it', role: 'builder' });
    const res = await withSol(async () => send('POST', '/threads', { channel: 'scratch', role: 'reviewer', prompt: 'review it', review_of: byClaude.id, source: 'conductor' }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ harness: 'codex', model: 'gpt-6.1-sol', effort: 'high' });
  });
});

describe('the model family of a run', () => {
  it('reads it from the model, then the harness, and says when it cannot tell', () => {
    expect(modelFamily({ harness: 'claude-code', model: 'claude-opus-5-5' })).toBe('claude');
    expect(modelFamily({ harness: 'claude-code', model: null })).toBe('claude');
    expect(modelFamily({ harness: 'hermes', model: null })).toBe('claude');
    expect(modelFamily({ harness: 'cursor', model: 'claude-4.6-sonnet' })).toBe('claude');
    expect(modelFamily({ harness: 'codex', model: null })).toBe('other');
    expect(modelFamily({ harness: 'cursor', model: 'composer-2.5' })).toBe('other');
    expect(modelFamily({ harness: 'cursor-cloud', model: 'grok-5' })).toBe('other');
    expect(modelFamily({ harness: 'cursor', model: 'auto' })).toBeNull();
    expect(modelFamily({ harness: 'cursor-cloud', model: null })).toBeNull();
    expect(modelFamily({ harness: 'vps-agent', model: null })).toBeNull();
  });

  it("refuses a review it cannot place, and one whose family's harness is down", () => {
    expect(reviewRun({}, { id: 't1', harness: 'cursor', model: 'auto' }, getCatalog())).toEqual({
      refused: 'Thread t1 ran on Cursor Agent auto, which does not say its model family, so Omni cannot pick the other one. Ask the user which model reviews it.',
    });
    const down = { ...getCatalog(), harnesses: getCatalog().harnesses.map((h) => (h.id === 'codex' ? { ...h, available: false, fix: 'codex login' } : h)) };
    expect(reviewRun({}, { id: 't2', harness: 'claude-code', model: 'claude-sonnet-5-5' }, down)).toEqual({
      refused: 'This review runs on GPT, on Codex, and Codex is not available. Run `codex login`. Ask the user how to review it.',
    });
  });
});

describe('the Review PR action', () => {
  it('says to show Builder when it is hidden, before asking GitHub', async () => {
    expect((await send('POST', '/crew/builder/hidden', { hidden: true })).status).toBe(200);
    await expect(requestPRReview('scratch', 'acme/shop', 12)).rejects.toMatchObject({
      status: 409,
      message: 'Review PR runs as Builder, which is hidden on this machine. Show it in Settings > Agents to use Review PR.',
    });
    await send('POST', '/crew/builder/hidden', { hidden: false });
  });
});
