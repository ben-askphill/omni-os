// Antigravity permissions (spec #977, ticket #980) through the real runner against the scripted fake `agy acp`
// (packages/test-fixtures/fake-agy.mjs): every permission request agy makes is judged by the channel's gate, so access
// levels and an agent's powers hold on Antigravity as on Claude Code and Codex. The fake really changes the disk once
// it is allowed, so a refused call is proven by the disk staying as it was.
//
// The fake asks about everything; the real agy does not ask before file edits (harness/antigravity/permissions.ts), so
// these suites test Omni's side of the contract, and a Read only level is not a promise on the real agy.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_AGY } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let agyLog: string;
const agy = { harness: 'antigravity', model: 'gemini-4-neon' };

const scratch = () => H.db.channels.get('scratch')!;
const folder = () => (scratch().repo_path ?? scratch().base_dir)!;
const setLevel = (level: string | null, connectors: Record<string, string> | null = null) =>
  H.db.channels.update('scratch', { access_level: level, connector_access: connectors ? JSON.stringify(connectors) : null });
const approvals = (id: string) => H.byKind(id, 'question').filter((e: Ev) => e.p.approval);
const requests = (): any[] => (existsSync(agyLog) ? readFileSync(agyLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A file in the thread's folder, made before the thread starts, with a name no other test uses. */
const seed = (body = 'original\n') => {
  const name = `f-${randomUUID().slice(0, 8)}.txt`;
  writeFileSync(join(folder(), name), body);
  return name;
};
const onDisk = (name: string) => (existsSync(join(folder(), name)) ? readFileSync(join(folder(), name), 'utf8') : null);
const results = (id: string) => H.byKind(id, 'tool_result').map((e: Ev) => e.p);

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omni-agy-perm-'));
  agyLog = join(tmp, 'agy.jsonl');
  mkdirSync(join(tmp, 'home'));
  H = await startRunner({
    HOME: join(tmp, 'home'),
    OMNI_ANTIGRAVITY_BIN: FAKE_AGY,
    OMNI_ANTIGRAVITY_CHECK_MS: '4000',
    OMNI_ANTIGRAVITY_CANCEL_MS: '800',
    FAKE_AGY_LOG: agyLog,
    FAKE_AGY_SESSIONS: join(tmp, 'sessions'),
  });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
}, 30_000);
afterEach(() => setLevel(null));

describe('a Read only channel', () => {
  it('refuses an edit, a delete, a move and a shell write, leaves the disk alone and still runs a read and ls', async () => {
    setLevel('read');
    const edited = seed();
    const deleted = seed();
    const moved = seed();
    const t = await H.start(`EDIT ${edited}\nDELETE ${deleted}\nMOVE ${moved} ${moved}.moved\nCMD touch ${edited}.made && ls`, agy);
    await H.untilResults(t.id, 1);
    expect(onDisk(edited)).toBe('original\n');
    expect(onDisk(deleted)).toBe('original\n');
    expect(onDisk(moved)).toBe('original\n');
    expect(onDisk(`${moved}.moved`)).toBeNull();
    expect(onDisk(`${edited}.made`)).toBeNull();
    expect(approvals(t.id)).toHaveLength(0);
    // Each refusal is answered reject_once, never allow, and the thread says why.
    const answers = requests().filter((r) => r.kind === 'response' && r.result?.outcome);
    expect(answers.map((a) => a.result.outcome)).toEqual(Array(4).fill({ outcome: 'selected', optionId: 'deny' }));
    expect(H.byKind(t.id, 'tool_use').filter((e: Ev) => e.p.name === 'Edit')).toHaveLength(3);
    expect(results(t.id).filter((r: any) => r.is_error && /channel is read only/.test(r.text))).toHaveLength(4);
  });

  it('runs a read-only command', async () => {
    setLevel('read');
    const t = await H.start('CMD ls', agy);
    await H.untilResults(t.id, 1);
    expect(results(t.id)[0]).toMatchObject({ is_error: false });
    expect(results(t.id)[0].text).toContain('ran ls');
  });
});

/** An agent on Antigravity, saved the way the Crew settings do. */
async function makeAgent(id: string, fields: Record<string, unknown>) {
  const { saveCrew } = await import('../crew-store.ts');
  const ctx = { catalog: (await import('../harness/catalog-service.ts')).getCatalog(), channelExists: () => true };
  saveCrew(id, { fields: { name: id, harness: 'antigravity', model: 'gemini-4-neon', avatar: { bg: '#f5e6ba' }, ...fields } }, ctx, { create: true });
}
const allow = async (id: string, label = 'Allow') => {
  const { answerQuestion } = await import('../runner.ts');
  await H.until('an approval card', () => approvals(id).filter((e: Ev) => !e.p.answered).length > 0);
  await answerQuestion(id, approvals(id).at(-1)!.p.id, [{ selected: [label], other: null }]);
};

describe('a Writer set to Read only', () => {
  it('stays read only in a Full access channel: every change is refused, a read and ls still run', async () => {
    setLevel('full');
    await makeAgent('scribe', { access: 'read' });
    const edited = seed();
    const deleted = seed();
    const moved = seed();
    const t = await H.start(`EDIT ${edited}\nDELETE ${deleted}\nMOVE ${moved} ${moved}.moved\nCMD touch ${edited}.made && ls`, { ...agy, role: 'scribe' } as any);
    await H.untilResults(t.id, 1);
    expect([onDisk(edited), onDisk(deleted), onDisk(moved), onDisk(`${moved}.moved`), onDisk(`${edited}.made`)]).toEqual(['original\n', 'original\n', 'original\n', null, null]);
    expect(results(t.id).filter((r: any) => r.is_error && /read only/.test(r.text))).toHaveLength(4);
    expect(approvals(t.id)).toHaveLength(0);
    const ls = await H.start('CMD ls', { ...agy, role: 'scribe' } as any);
    await H.untilResults(ls.id, 1);
    expect(results(ls.id)[0]).toMatchObject({ is_error: false });
  });
});

describe('an Ask first channel', () => {
  it('runs an edit inside the thread folder, and shows a card for an edit elsewhere and for a changing command', async () => {
    setLevel('ask');
    const inside = seed();
    const t = await H.start(`EDIT ${inside}`, agy);
    await H.untilResults(t.id, 1);
    expect(approvals(t.id)).toHaveLength(0);
    expect(onDisk(inside)).toBe('edited by fake agy\n');

    const outsideName = `elsewhere-${randomUUID().slice(0, 8)}.txt`;
    const outside = join(folder(), '..', outsideName);
    const e = await H.start(`EDIT ../${outsideName}`, agy);
    await H.until('a card for the edit', () => approvals(e.id).length === 1);
    expect(approvals(e.id)[0].p.approval).toMatchObject({ tool: 'Edit' });
    expect(existsSync(outside)).toBe(false);
    await allow(e.id);
    await H.untilResults(e.id, 1);
    expect(existsSync(outside)).toBe(true);

    const made = `ran-${randomUUID().slice(0, 8)}`;
    const c = await H.start(`CMD touch ${made}`, agy);
    await H.until('a card for the command', () => approvals(c.id).length === 1);
    expect(approvals(c.id)[0].p.approval).toMatchObject({ tool: 'Bash', summary: `touch ${made}` });
    expect(onDisk(made)).toBeNull();
    // The request is answered allow_once, never allow_always.
    await allow(c.id);
    await H.untilResults(c.id, 1);
    expect(onDisk(made)).not.toBeNull();
    const last = requests().filter((r) => r.kind === 'response' && r.result?.outcome).at(-1);
    expect(last.result.outcome).toEqual({ outcome: 'selected', optionId: 'allow' });
  });

  it('shows the reason when the user refuses, and runs nothing', async () => {
    setLevel('ask');
    const made = `refused-${randomUUID().slice(0, 8)}`;
    const t = await H.start(`CMD touch ${made}`, agy);
    await allow(t.id, 'Don’t allow');
    await H.untilResults(t.id, 1);
    expect(onDisk(made)).toBeNull();
    expect(results(t.id).some((r: any) => r.is_error && /did not allow/.test(r.text))).toBe(true);
  });

  it('reuses Allow in this thread, and Always allow for the agent in another thread, without a second card', async () => {
    setLevel('ask');
    await makeAgent('drafter', {});
    const t = await H.start(`CMD touch one-${randomUUID().slice(0, 6)}`, { ...agy, role: 'drafter' } as any);
    await allow(t.id, 'Allow in this thread');
    await H.untilResults(t.id, 1);
    await H.runner.postMessage(t.id, `CMD touch two-${randomUUID().slice(0, 6)}`);
    await H.untilResults(t.id, 2);
    expect(approvals(t.id)).toHaveLength(1);

    const a = await H.start(`CMD touch role-${randomUUID().slice(0, 6)}`, { ...agy, role: 'drafter' } as any);
    await allow(a.id, 'Always allow for drafter');
    await H.untilResults(a.id, 1);
    const b = await H.start(`CMD touch role2-${randomUUID().slice(0, 6)}`, { ...agy, role: 'drafter' } as any);
    await H.untilResults(b.id, 1);
    expect(approvals(b.id)).toHaveLength(0);
  });
});

describe('Full access', () => {
  it('shows no cards for any tool', async () => {
    setLevel('full');
    const a = seed();
    const t = await H.start(`EDIT ${a}\nDELETE ${a}\nSUBAGENT\nCMD touch ${a}.ok`, agy);
    await H.untilResults(t.id, 1);
    expect(approvals(t.id)).toHaveLength(0);
    expect(onDisk(`${a}.ok`)).not.toBeNull();
    expect(onDisk(a)).toBeNull();
  });
});

describe('agents with limited tools', () => {
  it('takes file edits from a No file edits agent and keeps its shell', async () => {
    setLevel('full');
    await makeAgent('trim', { tools: 'no-edits' });
    const edited = seed();
    const made = `trim-${randomUUID().slice(0, 6)}`;
    const t = await H.start(`EDIT ${edited}\nCMD touch ${made}`, { ...agy, role: 'trim' } as any);
    await H.untilResults(t.id, 1);
    expect(onDisk(edited)).toBe('original\n');
    expect(onDisk(made)).not.toBeNull();
    expect(results(t.id).some((r: any) => r.is_error && /without file edits/.test(r.text))).toBe(true);
  });

  it('lets a delegate-only agent and a quick ask only read', async () => {
    setLevel('full');
    await makeAgent('router', { tools: 'delegate-only' });
    const made = `ro-${randomUUID().slice(0, 6)}`;
    const d = await H.start(`CMD touch ${made}\nCMD ls`, { ...agy, role: 'router' } as any);
    await H.untilResults(d.id, 1);
    expect(onDisk(made)).toBeNull();
    const { startQuickAsk } = await import('../quick-ask.ts');
    const q = await startQuickAsk({ channel: 'scratch', prompt: `CMD touch ${made}`, harness: 'antigravity', model: 'gemini-4-neon' } as any);
    await H.untilResults(q.id, 1);
    expect(onDisk(made)).toBeNull();
    expect(results(q.id).some((r: any) => r.is_error && /read only/.test(r.text))).toBe(true);
  });
});

describe('connectors and sub-agents', () => {
  it('refuses a connector that is off even for a read, asks for a connector write at Ask first, and runs Omni\'s own tools', async () => {
    setLevel('full', { gmail: 'off' });
    const off = await H.start('MCPCALL gmail search_threads', agy);
    await H.untilResults(off.id, 1);
    expect(results(off.id).some((r: any) => r.is_error && /gmail is off/.test(r.text))).toBe(true);

    setLevel('ask');
    const w = await H.start('MCPCALL gmail send_message', agy);
    await H.until('a card for the connector write', () => approvals(w.id).length === 1);
    expect(approvals(w.id)[0].p.approval).toMatchObject({ tool: 'mcp__gmail__send_message', connector: 'gmail' });
    await allow(w.id, 'Don’t allow');
    await H.untilResults(w.id, 1);

    const own = await H.start('MCPCALL omni list_threads', agy);
    await H.untilResults(own.id, 1);
    expect(approvals(own.id)).toHaveLength(0);
  });

  it('refuses a sub-agent launch below Full access', async () => {
    setLevel('ask');
    const t = await H.start('SUBAGENT', agy);
    await H.untilResults(t.id, 1);
    expect(approvals(t.id)).toHaveLength(0);
    expect(results(t.id).some((r: any) => r.is_error && /sub-agents run on Antigravity only at Full access/.test(r.text))).toBe(true);
  });
});

describe('the tripwire', () => {
  it('stops the turn when an edit runs without asking, names the tool and records a tool failure', async () => {
    setLevel('read');
    const edited = seed();
    const t = await H.start(`EDIT ${edited} RUNFREE`, agy);
    await H.untilResults(t.id, 1);
    const errors = H.byKind(t.id, 'error').map((e: Ev) => e.p.text);
    expect(errors.some((x: string) => /ran Edit without asking Omni first/.test(x))).toBe(true);
    expect(H.thread(t.id).status).toBe('failed');
    const { toolFailures } = await import('../tool-failures.ts');
    expect((toolFailures.groups() as any[]).some((g) => g.harness === 'antigravity' && g.tool === 'Edit' && g.category === 'permission')).toBe(true);
  });

  it('lets a command agy knows only reads run unasked', async () => {
    setLevel('read');
    const t = await H.start('CMD ls RUNFREE', agy);
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'error')).toHaveLength(0);
  });

  it('stops the turn when an MCP call or a fetch runs without asking', async () => {
    setLevel('ask');
    const m = await H.start('MCPCALL gmail send_message RUNFREE', agy);
    await H.untilResults(m.id, 1);
    expect(H.byKind(m.id, 'error').some((e: Ev) => /ran mcp__gmail__send_message without asking Omni first/.test(e.p.text))).toBe(true);
    expect(H.thread(m.id).status).toBe('failed');
    const f = await H.start('FETCH https://example.com/ RUNFREE', agy);
    await H.until('the fetch tripwire', () => H.byKind(f.id, 'error').length > 0);
    expect(H.byKind(f.id, 'error').some((e: Ev) => /ran WebFetch without asking Omni first/.test(e.p.text))).toBe(true);
  });

  it('lets Omni\'s own tools run unasked, as the gate always allows them', async () => {
    setLevel('read');
    const t = await H.start('MCPCALL omni list_threads RUNFREE', agy);
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'error')).toHaveLength(0);
  });

  it('stops the turn when an unasked changing call ends failed', async () => {
    setLevel('read');
    const edited = seed();
    const t = await H.start(`EDIT ${edited} RUNFREE FAILED`, agy);
    await H.until('the tripwire', () => H.byKind(t.id, 'error').length > 0);
    expect(H.byKind(t.id, 'error').some((e: Ev) => /ran Edit without asking Omni first/.test(e.p.text))).toBe(true);
  });

  it('does not trip at Full access', async () => {
    setLevel('full');
    const edited = seed();
    const t = await H.start(`EDIT ${edited} RUNFREE`, agy);
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'error')).toHaveLength(0);
  });
});

describe('a session that ends while an approval waits', () => {
  it('dismisses the card and answers agy cancelled', async () => {
    setLevel('ask');
    const t = await H.start('WAITASK', agy);
    await H.until('a card', () => approvals(t.id).length === 1);
    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped');
    const { questionsIn } = await import('@omni/shared/question.ts');
    const { events } = await import('../db.ts');
    expect(questionsIn(events.questions(t.id)).find((q: any) => q.approval)?.state).toBe('dismissed');
    await H.until('agy got its answer', () => requests().some((r) => r.kind === 'response' && r.result?.outcome?.outcome === 'cancelled'));
  });
});

describe('how a request is classified', () => {
  it('never reads a changing kind as an MCP call, whatever its input names', async () => {
    const { callOf } = await import('../harness/antigravity/permissions.ts');
    const call = { kind: 'execute', title: 'rm -rf x', rawInput: { server: 'omni', tool: 'list_threads', CommandLine: 'rm -rf x' } };
    expect(callOf(call as any)).toMatchObject({ tool: 'Bash' });
    expect(callOf({ title: 'rm -rf x', rawInput: { server: 'omni', tool: 'list_threads', CommandLine: 'rm -rf x' } } as any)).toMatchObject({ tool: 'Bash' });
    expect(callOf({ kind: 'edit', title: 'mcp__omni__x', rawInput: { path: 'a' } } as any)).toMatchObject({ tool: 'Edit', edits: true });
  });

  it('reads an MCP call from its own name, as agy shows it, not from its input', async () => {
    const { callOf } = await import('../harness/antigravity/permissions.ts');
    const real = { kind: 'other', name: 'mcp_gmail_send_message', title: 'Run mcp_gmail_send_message', rawInput: { to: 'a@b.c' } };
    expect(callOf(real as any)).toMatchObject({ tool: 'mcp__gmail__send_message', input: { to: 'a@b.c' } });
    // Input that happens to carry server and tool fields is only input.
    expect(callOf({ ...real, rawInput: { server: 'omni', tool: 'list_threads' } } as any)).toMatchObject({ tool: 'mcp__gmail__send_message' });
    expect(callOf({ kind: 'other', title: 'Run something', rawInput: { server: 'omni', tool: 'list_threads' } } as any)).not.toMatchObject({ tool: expect.stringMatching(/^mcp__/) });
    // A name only the request carries still reads: the title's last word is the same name.
    expect(callOf({ kind: 'other', title: 'Run mcp_gmail_send_message', rawInput: {} } as any)).toMatchObject({ tool: 'mcp__gmail__send_message' });
    // Omni's own server has dashes in its name, and the session's server names split it.
    expect(callOf({ kind: 'other', name: 'mcp_omni-ask_ask_user', rawInput: {} } as any, ['omni-ask'])).toMatchObject({ tool: 'mcp__omni-ask__ask_user' });
  });
});
