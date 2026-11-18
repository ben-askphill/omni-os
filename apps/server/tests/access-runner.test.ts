import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startRunner } from './runner-boot.ts';

// A6 end to end on Claude Code (the fake CLI speaks the real permission protocol): a read-only channel cannot run a
// write tool, an Ask first channel pauses on an approval card until the user answers, and a channel with full access
// runs as it always did.
const r = await startRunner();
const { app } = await import('../app.ts');
const { answerQuestion } = await import('../runner.ts');
const { CALLER_HEADER } = await import('../automation-guard.ts');
const token = (await import('../api-token.ts')).apiToken();
const api = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

const scratch = () => r.db.channels.get('scratch')!;
const folder = () => (scratch().repo_path ?? scratch().base_dir)!;
const setLevel = (level: string | null, connectors: Record<string, string> | null = null) =>
  r.db.channels.update('scratch', { access_level: level, connector_access: connectors ? JSON.stringify(connectors) : null });
const approvals = (id: string) => r.byKind(id, 'question').filter((e) => e.p.approval);
const args = (id: string) => r.spawns(id).at(-1)?.args as string[];

describe('access levels on Claude Code', () => {
  it('runs a full-access channel exactly as before: bypassPermissions, no permission requests', async () => {
    setLevel('full');
    const file = `full-${randomUUID()}.txt`;
    const t = await r.start(`WRITE:${file}`);
    await r.untilResults(t.id, 1);
    expect(args(t.id)).toContain('bypassPermissions');
    expect(args(t.id)).not.toContain('--permission-prompt-tool');
    expect(existsSync(join(folder(), file))).toBe(true);
  });

  it('refuses a write tool in a read-only channel, without a card, and the agent hears why', async () => {
    setLevel('read');
    const file = `read-${randomUUID()}.txt`;
    const t = await r.start(`WRITE:${file} CMD:touch_${file}.cmd`);
    await r.untilResults(t.id, 1);
    expect(args(t.id)).toEqual(expect.arrayContaining(['--permission-mode', 'default', '--permission-prompt-tool', 'stdio']));
    expect(existsSync(join(folder(), file))).toBe(false);
    expect(existsSync(join(folder(), `${file}.cmd`))).toBe(false);
    expect(approvals(t.id)).toHaveLength(0);
    const results = r.byKind(t.id, 'tool_result').map((e) => JSON.stringify(e.p));
    expect(results.some((s) => s.includes('the channel is read only'))).toBe(true);
  });

  it('pauses an Ask first channel on an approval card, and runs the command once the user allows it', async () => {
    setLevel('ask');
    const file = `ask-${randomUUID()}.txt`;
    const t = await r.start(`CMD:touch_${file}`);
    await r.until('an approval card', () => approvals(t.id).length === 1);
    const card = approvals(t.id)[0].p;
    expect(card.approval).toMatchObject({ tool: 'Bash', summary: `touch ${file}`, level: 'ask' });
    expect(card.questions[0]).toMatchObject({ question: `Run a command: touch ${file}`, header: 'Ask first' });
    // Waiting: the command has not run, and the thread is still at work.
    await new Promise((ok) => setTimeout(ok, 300));
    expect(existsSync(join(folder(), file))).toBe(false);
    expect(r.thread(t.id).status).toBe('running');
    // Needs you lists it like any question.
    const needs = await (await api('GET', '/needs-you')).json();
    expect(needs.items.find((i: any) => i.thread.id === t.id)?.blockers[0]).toMatchObject({ kind: 'question' });
    // An agent cannot answer it for the user.
    const forged = await api('POST', `/threads/${t.id}/questions/${card.id}/answer`, { answers: [{ selected: ['Allow'], other: null }] }, { [CALLER_HEADER]: t.id });
    expect(forged.status).toBe(403);
    await answerQuestion(t.id, card.id, [{ selected: ['Allow'], other: null }]);
    await r.untilResults(t.id, 1);
    expect(existsSync(join(folder(), file))).toBe(true);
  });

  it('stops the command when the user says no, and tells the agent', async () => {
    setLevel('ask');
    const file = `no-${randomUUID()}.txt`;
    const t = await r.start(`CMD:touch_${file}`);
    await r.until('an approval card', () => approvals(t.id).length === 1);
    await answerQuestion(t.id, approvals(t.id)[0].p.id, [{ selected: [], other: 'not on a Friday' }]);
    await r.untilResults(t.id, 1);
    expect(existsSync(join(folder(), file))).toBe(false);
    expect(r.texts(t.id, 'assistant_text').join(' ')).toContain('not on a Friday');
  });

  it('remembers Allow in this thread for the same tool, and nothing beyond the thread', async () => {
    setLevel('ask');
    const t = await r.start(`CMD:touch_one-${randomUUID()}`);
    await r.until('an approval card', () => approvals(t.id).length === 1);
    await answerQuestion(t.id, approvals(t.id)[0].p.id, [{ selected: ['Allow in this thread'], other: null }]);
    await r.untilResults(t.id, 1);
    const file = `two-${randomUUID()}`;
    await r.runner.postMessage(t.id, `CMD:touch_${file}`);
    await r.untilResults(t.id, 2);
    expect(approvals(t.id)).toHaveLength(1);
    expect(existsSync(join(folder(), file))).toBe(true);
    const other = await r.start(`CMD:touch_three-${randomUUID()}`);
    await r.until('a card on another thread', () => approvals(other.id).length === 1);
    await answerQuestion(other.id, approvals(other.id)[0].p.id, [{ selected: ['Don’t allow'], other: null }]);
    await r.untilResults(other.id, 1);
  });

  it('keeps Always allow for a crew role in the channel, lists it in Channel settings, and only the user removes it', async () => {
    setLevel('ask');
    const t = await r.start(`CMD:touch_role-${randomUUID()}`, { role: 'researcher' });
    await r.until('an approval card', () => approvals(t.id).length === 1);
    const card = approvals(t.id)[0].p;
    expect(card.questions[0].options.map((o: any) => o.label)).toContain('Always allow for Researcher');
    await answerQuestion(t.id, card.id, [{ selected: ['Always allow for Researcher'], other: null }]);
    await r.untilResults(t.id, 1);
    expect((await (await api('GET', '/channels/scratch/access-grants')).json()).grants).toEqual([{ role: 'researcher', name: 'Researcher', tools: ['Bash'] }]);
    // Another thread as the same role runs the tool without a card; one with no role still asks.
    const file = `role-two-${randomUUID()}`;
    const again = await r.start(`CMD:touch_${file}`, { role: 'researcher' });
    await r.untilResults(again.id, 1);
    expect(approvals(again.id)).toHaveLength(0);
    expect(existsSync(join(folder(), file))).toBe(true);
    // An agent cannot take it back or widen it; the user can.
    expect((await api('DELETE', '/channels/scratch/access-grants/researcher', undefined, { [CALLER_HEADER]: t.id })).status).toBe(403);
    expect((await (await api('DELETE', '/channels/scratch/access-grants/researcher?tool=Bash')).json()).grants).toEqual([]);
  });

  it('turns a connector off on its own, even in a full-access channel', async () => {
    setLevel('full', { browser: 'off' });
    const t = await r.start(`WRITE:ok-${randomUUID()}.txt`);
    await r.untilResults(t.id, 1);
    // Not unrestricted any more: every call is asked, and the file write still runs at full access.
    expect(args(t.id)).toContain('--permission-prompt-tool');
    expect(approvals(t.id)).toHaveLength(0);
  });
});

describe('who sets levels', () => {
  it('refuses an agent thread that tries to change a level, and lets the user', async () => {
    setLevel(null);
    const agent = await api('PATCH', '/channels/scratch', { access_level: 'full' }, { [CALLER_HEADER]: 'some-thread' });
    expect(agent.status).toBe(403);
    expect((await agent.json()).error).toMatch(/Agents cannot change access levels/);
    const user = await api('PATCH', '/channels/scratch', { access_level: 'read', connector_access: { gmail: 'off' } });
    expect(user.status).toBe(200);
    expect(scratch()).toMatchObject({ access_level: 'read', connector_access: JSON.stringify({ gmail: 'off' }) });
    const bad = await api('PATCH', '/channels/scratch', { connector_access: { jira: 'off' } });
    expect(bad.status).toBe(400);
    setLevel(null);
  });

  it('refuses a switch to Hermes in a channel below full access', async () => {
    setLevel('ask');
    const t = await r.start('hi');
    await r.untilResults(t.id, 1);
    const { previewSwitch } = await import('../runner/switch.ts');
    expect((await previewSwitch(t.id, { harness: 'hermes', model: 'hermes', effort: '' })).blocked).toMatch(/Hermes runs off this machine/);
    setLevel(null);
  });
});
