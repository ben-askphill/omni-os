import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The routine settings A3 left out of the product, against a real db and the fake claude CLI: post nothing when empty
// (quiet), a dry run, the approval card's rules, and drafts that expire.

const dir = mkdtempSync(join(tmpdir(), 'omni-rules-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
const yaml = (id: string, body: string) => writeFileSync(join(dir, `${id}.yaml`), body);
const { parseAutomation } = await import('../automations.ts');
const { isQuietReply, runRules, withRunRules, QUIET_REPLY } = await import('../automation-rules.ts');
const { spanWords } = await import('@omni/shared/cron.ts');
const { expireDrafts, expiredAnswer } = await import('../automation-drafts.ts');
const { fileQuietRun } = await import('../automation-quiet.ts');
const { askQuestion } = await import('../runner/questions.ts');
const { app } = await import('../app.ts');
const { db } = await import('../db.ts');

const run = async (id: string, body?: unknown) => {
  const res = await app.request(`/api/automations/${id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; title: string };
};
const needsYou = async () => ((await (await app.request('/api/needs-you')).json()) as { items: { thread: { id: string } }[] }).items.map((i) => i.thread.id);

describe('parsing quiet, approve and expires', () => {
  const parse = (extra: string) => parseAutomation('x', `name: X\ncron: "0 9 * * *"\nchannel: scratch\nprompt: hi\n${extra}`);

  it('reads them, with expires as seconds', () => {
    expect(parse('quiet: true\napprove: true\nexpires: 8h\n')).toMatchObject({ quiet: true, approve: true, expiresAfter: 28_800 });
    expect(parse('')).not.toHaveProperty('quiet');
  });

  it('refuses an expiry without approval, or one that is not a duration', () => {
    expect(parse('expires: 8h\n').error).toMatch(/expires needs approve: true/);
    expect(parse('approve: true\nexpires: soon\n').error).toMatch(/expires must be seconds or a duration/);
  });
});

describe('saving them from the editor', () => {
  const save = async (fields: Record<string, unknown>) => {
    const res = await app.request('/api/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { name: 'Saved', enabled: false, cron: '0 9 * * *', channel: 'scratch', prompt: 'hi', ...fields } }),
    });
    return { status: res.status, body: (await res.json()) as { id: string; error?: string } };
  };
  const definition = async (id: string) => ((await (await app.request(`/api/automations/${id}/definition`)).json()) as { yaml: string; fields: Record<string, unknown> });

  it('writes quiet, approve and expires in the file and reads them back', async () => {
    const { body } = await save({ quiet: true, approve: true, expires: '8h' });
    const def = await definition(body.id);
    expect(def.fields).toMatchObject({ quiet: true, approve: true, expires: '8h' });
    expect(def.yaml).toMatch(/quiet: true\napprove: true\nexpires: 8h\nprompt:/);
  });

  it('drops an expiry saved without approval, and leaves all three out when off', async () => {
    const { body } = await save({ name: 'Saved 2', quiet: false, approve: false, expires: '8h' });
    const def = await definition(body.id);
    expect(def.fields).toMatchObject({ quiet: false, approve: false, expires: '' });
    expect(def.yaml).not.toMatch(/quiet|approve|expires/);
  });

  it('refuses an expiry that is not a duration', async () => {
    expect((await save({ name: 'Saved 3', approve: true, expires: 'soon' })).status).toBe(400);
  });
});

describe('the rules a run follows', () => {
  it('adds nothing for a plain automation, so its prompt is sent as written', () => {
    expect(withRunRules({}, 'Do the thing')).toBe('Do the thing');
  });

  it('quiet asks for the one word, approve for the card with its expiry, a dry run for a list and no card', () => {
    const quiet = runRules({ quiet: true });
    expect(quiet).toEqual([expect.stringContaining(`reply with exactly ${QUIET_REPLY} and nothing else`)]);
    const approve = runRules({ approve: true, expiresAfter: 28_800 }).join('\n');
    expect(approve).toContain('"Approve and go ahead?"');
    expect(approve).toContain('options "Approve" and "Skip"');
    expect(approve).toContain('it expires in 8 hours if nobody answers');
    const dry = runRules({ approve: true, quiet: true }, true).join('\n');
    expect(dry).toContain('This is a dry run');
    expect(dry).not.toContain('Approve and go ahead');
    expect(dry).not.toContain(QUIET_REPLY);
    expect(withRunRules({ quiet: true }, 'Check my mail\n')).toBe(`Check my mail\n\nHow this run works:\n- ${quiet[0]}`);
  });

  it('reads a quiet reply with quotes, case or a full stop around it, and nothing longer', () => {
    for (const s of ['NOTHING_TO_REPORT', ' nothing_to_report. ', '`NOTHING_TO_REPORT`', '**NOTHING_TO_REPORT**']) expect(isQuietReply(s)).toBe(true);
    for (const s of ['', 'NOTHING_TO_REPORT, but one thing', 'Nothing to report', null]) expect(isQuietReply(s)).toBe(false);
  });

  it('says an expiry in words', () => {
    expect([spanWords(28_800), spanWords(3600), spanWords(172_800), spanWords(5400)]).toEqual(['8 hours', '1 hour', '2 days', '90 minutes']);
  });
});

describe('post nothing when empty', () => {
  it('files a quiet run with nothing to report as done, out of Needs you', async () => {
    yaml('q1', `name: Quiet\ncron: "0 9 * * *"\nchannel: scratch\nquiet: true\nprompt: SAY:${QUIET_REPLY}\n`);
    const t = await run('q1');
    await r.untilResults(t.id, 1);
    await r.until('done mark', () => r.db.threads.get(t.id)!.done_at);
    expect(r.db.threads.get(t.id)).toMatchObject({ status: 'done', automation: 'q1' });
    expect(await needsYou()).not.toContain(t.id);
  });

  it('keeps a quiet run that found something, and a plain run that says the word, in Needs you', async () => {
    yaml('q2', `name: Found\ncron: "0 9 * * *"\nchannel: scratch\nquiet: true\nprompt: SAY:Two mails need you\n`);
    yaml('q3', `name: Loud\ncron: "0 9 * * *"\nchannel: scratch\nprompt: SAY:${QUIET_REPLY}\n`);
    const found = await run('q2');
    const loud = await run('q3');
    await r.untilResults(found.id, 1);
    await r.untilResults(loud.id, 1);
    expect(r.db.threads.get(found.id)!.done_at).toBeNull();
    expect(r.db.threads.get(loud.id)!.done_at).toBeNull();
    expect(await needsYou()).toEqual(expect.arrayContaining([found.id, loud.id]));
  });
});

describe('post nothing when empty: only the run itself', () => {
  const send = async (id: string, prompt: string) => {
    const res = await app.request(`/api/threads/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, mode: 'queue' }) });
    expect(res.status).toBeLessThan(300);
  };

  it('a later turn the user started is never filed away, however it ends', async () => {
    yaml('q4', `name: Quiet later\ncron: "0 9 * * *"\nchannel: scratch\nquiet: true\nprompt: SAY:Found one thing\n`);
    const t = await run('q4');
    await r.untilResults(t.id, 1);
    await send(t.id, `SAY:${QUIET_REPLY}`);
    await r.untilResults(t.id, 2);
    expect(r.db.threads.get(t.id)!.done_at).toBeNull();
  });

  it('a run that asked a question is not filed away when it then says the word', async () => {
    yaml('q5', `name: Quiet asked\ncron: "0 9 * * *"\nchannel: scratch\nquiet: true\nprompt: SAY:Found one thing\n`);
    const t = await run('q5');
    await r.untilResults(t.id, 1);
    expect(fileQuietRun(t.id, QUIET_REPLY)).toBe(true);
    r.db.threads.setDone(t.id, false);
    askQuestion(t.id, [{ question: 'Approve and go ahead?', header: 'Approve', multiSelect: false, options: [{ label: 'Approve', description: 'Send it' }, { label: 'Skip', description: 'Do nothing' }] }]);
    expect(fileQuietRun(t.id, QUIET_REPLY)).toBe(false);
    expect(r.db.threads.get(t.id)!.done_at).toBeNull();
  });
});

describe('dry run', () => {
  it('names the thread a dry run and tells the agent to act on nothing', async () => {
    yaml('d1', `name: Send invoices\ncron: "0 9 * * *"\nchannel: scratch\napprove: true\nprompt: Send this week's invoices\n`);
    const t = await run('d1', { dry: true });
    expect(t.title).toMatch(/^Dry run · Send invoices · /);
    await r.untilResults(t.id, 1);
    const sent = r.events(t.id).find((e) => e.kind === 'user')!.p.text as string;
    expect(sent).toContain("Send this week's invoices");
    expect(sent).toContain('This is a dry run.');
    expect(sent).not.toContain('Approve and go ahead');
    const plain = await run('d1');
    expect(plain.title).not.toMatch(/^Dry run/);
  });
});

describe('drafts that expire', () => {
  const ask = (threadId: string) =>
    askQuestion(threadId, [{ question: 'Approve and go ahead?', header: 'Approve', multiSelect: false, options: [{ label: 'Approve', description: 'Send it' }, { label: 'Skip', description: 'Do nothing' }] }]);

  it('answers an approval nobody answered in time as expired, and marks the run done', async () => {
    yaml('e1', `name: Follow-ups\ncron: "0 9 * * *"\nchannel: scratch\napprove: true\nexpires: 2h\nprompt: Draft replies\n`);
    const t = await run('e1');
    await r.untilResults(t.id, 1);
    const { id } = ask(t.id);
    expect(await expireDrafts(Date.now() + 3600_000)).toEqual([]);
    expect(await expireDrafts(Date.now() + 2 * 3600_000 + 1000)).toEqual([t.id]);
    const answer = r.events(t.id).find((e) => e.kind === 'question_answer' && e.p.id === id)!;
    expect(answer.p.answers).toEqual([{ selected: [], other: expiredAnswer(7200) }]);
    expect(r.db.threads.get(t.id)!.done_at).toBeTruthy();
    expect(await expireDrafts(Date.now() + 9 * 3600_000)).toEqual([]);
  });

  it('leaves alone a card whose automation sets no expiry, however old', async () => {
    yaml('e2', `name: No expiry\ncron: "0 9 * * *"\nchannel: scratch\napprove: true\nprompt: Draft replies\n`);
    const t = await run('e2');
    await r.untilResults(t.id, 1);
    ask(t.id);
    db.prepare(`UPDATE events SET created_at = '2000-01-01T00:00:00.000Z' WHERE thread_id = ? AND kind = 'question'`).run(t.id);
    expect(await expireDrafts()).not.toContain(t.id);
    expect(r.db.threads.get(t.id)!.done_at).toBeNull();
  });
});
