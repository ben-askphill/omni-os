import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// Two safety rules for automations. A thread an automation started, or any thread below one, cannot create, change,
// turn on or run automations (automation-guard.ts); Omni's MCP servers name their thread on every call. And an
// automation is turned off after 3 failed runs in a row (automation-pause.ts), with a history row saying why.

const shipped = mkdtempSync(join(tmpdir(), 'omni-automation-guard-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: shipped });
const yaml = (name: string) => `name: ${name}\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: tidy up\n`;
writeFileSync(join(shipped, 'nightly.yaml'), yaml('Nightly'));
writeFileSync(join(shipped, 'flaky.yaml'), yaml('Flaky'));
writeFileSync(join(shipped, 'steady.yaml'), yaml('Steady'));
writeFileSync(join(shipped, 'patient.yaml'), yaml('Patient'));
const { app } = await import('../app.ts');
const { loadAutomations } = await import('../automations.ts');
const { FAILURE_LIMIT, PAUSE_REASON, failuresInARow, pauseIfFailing, watchAutomationFailures } = await import('../automation-pause.ts');
const { SCAN_ROLE } = await import('../usage-scan/asks.ts');
const { paths } = await import('../config.ts');
const { automationRuns, db, events, threads } = r.db;

let n = 0;
function thread(o: { source?: string; role?: string | null; automation?: string | null; parent?: string | null; channel?: string; status?: string } = {}) {
  const id = `g${++n}`;
  db.prepare(
    `INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role, automation, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, o.channel ?? 'scratch', `Thread ${n}`, o.status ?? 'done', id, r.tmp, o.source ?? 'manual', o.role ?? null, o.automation ?? null, o.parent ?? null);
  return id;
}

const call = async (method: string, path: string, body?: unknown, caller?: string) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(caller && { 'x-omni-thread': caller }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const fields = (name: string, over: Record<string, unknown> = {}) => ({ name, enabled: true, cron: '0 9 * * 1-5', channel: 'scratch', prompt: 'Check the shop.', ...over });
const find = (id: string) => loadAutomations().find((a) => a.id === id);

describe('threads an automation started', () => {
  const run = thread({ source: 'automation', automation: 'nightly' });
  const delegated = thread({ source: 'conductor', parent: run });
  const grandchild = thread({ source: 'team', parent: delegated });

  it('cannot create an automation, at any depth below the run', async () => {
    for (const [caller, name] of [[run, 'From the run'], [delegated, 'From its crewmate'], [grandchild, 'From a team member']]) {
      const { status, body } = await call('POST', '/automations', { fields: fields(name) }, caller);
      expect(status).toBe(403);
      expect(body.error).toMatch(/automation "nightly"/);
    }
    expect(existsSync(join(paths.personalAutomations, 'from-the-run.yaml'))).toBe(false);
    expect(find('from-the-run')).toBeUndefined();
  });

  it('cannot change one, turn one on, run one, retry a delivery or start a usage scan', async () => {
    expect((await call('PUT', '/automations/nightly', { fields: fields('Nightly') }, delegated)).status).toBe(403);
    expect((await call('POST', '/automations/nightly/enabled', { enabled: true }, delegated)).status).toBe(403);
    expect((await call('POST', '/automations/nightly/run', undefined, delegated)).status).toBe(403);
    expect((await call('POST', '/automations/nightly/reset', undefined, delegated)).status).toBe(403);
    expect((await call('POST', '/deliveries/any/retry', { attempt: 1 }, delegated)).status).toBe(403);
    expect((await call('POST', '/usage-scan', {}, delegated)).status).toBe(403);
    // No run started: the only nightly thread is the one this test made.
    expect(r.db.db.prepare(`SELECT id FROM threads WHERE automation = 'nightly'`).all()).toEqual([{ id: run }]);
  });

  it('may still turn one off', async () => {
    expect((await call('POST', '/automations/nightly/enabled', { enabled: false }, delegated)).status).toBe(200);
    expect(find('nightly')?.enabled).toBe(false);
    expect((await call('POST', '/automations/nightly/enabled', { enabled: true })).status).toBe(200);
  });

  it('cannot create one from a thread continued out of one below the run', async () => {
    // continue.ts starts the new thread with no automation. A delegated source's parent and source carry over, so both
    // parent_id and continued_from link it to the run.
    const { loadCatalog } = await import('../harness/catalog-service.ts');
    await loadCatalog(['claude-code']);
    const crewmate = 'g-crewmate';
    db.prepare(
      `INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, automation, parent_id, harness, model, effort) VALUES (?, 'scratch', 'Crewmate', 'done', ?, ?, 'conductor', NULL, ?, 'claude-code', 'sonnet', 'high')`,
    ).run(crewmate, crewmate, r.tmp, run);
    events.add(crewmate, 'user', { text: 'Report only.', source: 'conductor' });
    events.add(crewmate, 'assistant_text', { text: 'Finished.' });
    const how = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
    const preview = await call('POST', `/threads/${crewmate}/continue/preview`, how);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const made = await call('POST', `/threads/${crewmate}/continue`, { ...how, text: 'Make the automation.', request_id: 'continue-guard', revision: preview.body.revision });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const continued = made.body.thread;
    expect(continued).toMatchObject({ parent_id: run, automation: null, source: 'conductor', continued_from: crewmate });

    const { status, body } = await call('POST', '/automations', { fields: fields('From the continuation') }, continued.id);
    expect(status).toBe(403);
    expect(body.error).toMatch(/automation "nightly"/);
    expect(find('from-the-continuation')).toBeUndefined();
  });

  it('holds a thread however deep below the run it sits', async () => {
    let bottom = run;
    for (let i = 0; i < 100; i++) bottom = thread({ source: 'conductor', parent: bottom });
    const { status, body } = await call('POST', '/automations', { fields: fields('From deep down') }, bottom);
    expect(status).toBe(403);
    expect(body.error).toMatch(/automation "nightly"/);
  });

  it('ends the walk up on a cycle in bad data', async () => {
    const a = 'g-cycle-a';
    const b = 'g-cycle-b';
    for (const [id, up] of [[a, b], [b, a]]) {
      db.prepare(`INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source) VALUES (?, 'scratch', 'Cycle', 'done', ?, ?, 'manual')`).run(id, id, r.tmp);
      db.prepare('UPDATE threads SET continued_from = ? WHERE id = ?').run(up, id);
    }
    expect((await call('POST', '/automations', { fields: fields('From a cycle') }, a)).status).toBe(201);
  });

  it("does not hold other threads or Ben's own clients", async () => {
    const mine = thread();
    expect((await call('POST', '/automations', { fields: fields('From my thread') }, mine)).status).toBe(201);
    expect((await call('POST', '/automations', { fields: fields('From the web') })).status).toBe(201);
    expect(find('from-my-thread')?.enabled).toBe(true);
  });
});

describe("a usage scan's lead", () => {
  const scan = thread({ role: SCAN_ROLE, channel: 'inbox' });
  events.add(scan, 'user', { text: '# Usage scan', source: 'manual' });

  it('saves nothing before Ben answers in its thread', async () => {
    const { status, body } = await call('POST', '/automations', { fields: fields('Too early') }, scan);
    expect(status).toBe(403);
    expect(body.error).toMatch(/^Not yet/);
  });

  it('never changes, turns on or runs an existing one', async () => {
    expect((await call('PUT', '/automations/nightly', { fields: fields('Nightly') }, scan)).status).toBe(403);
    expect((await call('POST', '/automations/nightly/enabled', { enabled: true }, scan)).status).toBe(403);
    expect((await call('POST', '/automations/nightly/run', undefined, scan)).status).toBe(403);
    expect((await call('DELETE', '/automations/nightly', undefined, scan)).status).toBe(403);
  });

  it('once Ben answers, saves what he picked, always off', async () => {
    events.add(scan, 'user', { text: 'Save the first one', source: 'ben' });
    const { status, body } = await call('POST', '/automations', { fields: fields('Weekly copy check', { enabled: true }) }, scan);
    expect(status).toBe(201);
    expect(body.fields.enabled).toBe(false);
    expect(find('weekly-copy-check')?.enabled).toBe(false);
    const yaml = '# from the scan\nname: Daily copy check\nenabled: true\ncron: "0 9 * * 1-5"\nchannel: scratch\nprompt: Check the shop.\n';
    // A whole file could carry keys the fields cannot set, such as a precheck command.
    const fromYaml = await call('POST', '/automations', { yaml: `${yaml}precheck: "true"\n` }, scan);
    expect(fromYaml.status).toBe(403);
    expect(find('daily-copy-check')).toBeUndefined();
  });

  it('counts an answer to a question it asked', async () => {
    const asked = thread({ role: SCAN_ROLE, channel: 'inbox' });
    events.add(asked, 'user', { text: '# Usage scan', source: 'manual' });
    events.add(asked, 'question_answer', { id: 'q1', answers: { Save: 'Both' } });
    expect((await call('POST', '/automations', { fields: fields('Answered by card') }, asked)).status).toBe(201);
  });
});

describe('turning off after failed runs', () => {
  /** A run of the automation whose thread ended this way. */
  const ran = (automation: string, status: string) => {
    const id = thread({ source: 'automation', automation, status });
    automationRuns.add(automation, id, 'cron');
    return id;
  };

  it(`waits for ${FAILURE_LIMIT} failures in a row; skipped and stopped runs neither count nor break the streak`, () => {
    ran('flaky', 'failed');
    ran('flaky', 'failed');
    automationRuns.skip('flaky', 'cron', 'precheck exited 1: nothing new');
    ran('flaky', 'stopped');
    expect(failuresInARow('flaky')).toBe(2);
    expect(pauseIfFailing('flaky')).toBe(false);
    expect(find('flaky')?.enabled).toBe(true);
    ran('flaky', 'failed');
    expect(pauseIfFailing('flaky')).toBe(true);
    expect(find('flaky')?.enabled).toBe(false);
  });

  it('says why in the run history the clients read', async () => {
    const list = (await call('GET', '/automations')).body as any[];
    const flaky = list.find((a) => a.id === 'flaky');
    expect(flaky.enabled).toBe(false);
    expect(flaky.runs[0]).toMatchObject({ trigger: 'pause', status: 'skipped', skip_reason: PAUSE_REASON });
    // Already off: nothing more happens.
    expect(pauseIfFailing('flaky')).toBe(false);
  });

  it('counts failures with any number of skipped runs between them', () => {
    ran('patient', 'failed');
    ran('patient', 'failed');
    for (let i = 0; i < 120; i++) automationRuns.skip('patient', 'cron', 'precheck exited 1: nothing new');
    ran('patient', 'stopped');
    expect(failuresInARow('patient')).toBe(2);
    ran('patient', 'failed');
    expect(failuresInARow('patient')).toBe(FAILURE_LIMIT);
    expect(pauseIfFailing('patient')).toBe(true);
  });

  it('a run that finished breaks the streak', () => {
    for (const s of ['failed', 'failed', 'done', 'failed', 'failed']) ran('steady', s);
    expect(failuresInARow('steady')).toBe(2);
    expect(pauseIfFailing('steady')).toBe(false);
  });

  it('starts counting again when it is turned back on, and pauses as soon as a run thread fails the third time', async () => {
    expect((await call('POST', '/automations/flaky/enabled', { enabled: true })).status).toBe(200);
    ran('flaky', 'failed');
    expect(failuresInARow('flaky')).toBe(1);
    expect(pauseIfFailing('flaky')).toBe(false);
    watchAutomationFailures();
    ran('flaky', 'failed');
    const third = ran('flaky', 'running');
    threads.update(third, { status: 'failed' });
    r.bus.emit('feed', { type: 'thread', thread: threads.get(third) });
    expect(find('flaky')?.enabled).toBe(false);
  });
});
