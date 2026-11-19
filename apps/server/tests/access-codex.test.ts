import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// A6 on Codex: the level becomes its sandbox and approval policy, and an approval request Codex sends in an Ask first
// channel becomes the same card a Claude Code thread shows.
const r = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
const { answerQuestion } = await import('../runner.ts');
const setLevel = (level: string | null) => r.db.channels.update('scratch', { access_level: level });
const approvals = (id: string) => r.byKind(id, 'question').filter((e) => e.p.approval);
const started = (id: string) => r.codexRequests().filter((q: any) => q.method === 'thread/start' && q.params?.cwd === r.thread(id).cwd).at(-1)?.params;

describe('access levels on Codex', () => {
  it('runs read only in its read-only sandbox, never asking', async () => {
    setLevel('read');
    const t = await r.start('hi', { harness: 'codex' });
    await r.untilResults(t.id, 1);
    expect(started(t.id)).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only' });
  });

  it('asks first through the approval card and runs the command only after Allow', async () => {
    setLevel('ask');
    const t = await r.start('CMD', { harness: 'codex' });
    const file = join(r.thread(t.id).cwd, 'codex-approved.txt');
    rmSync(file, { force: true });
    await r.until('an approval card', () => approvals(t.id).length === 1);
    expect(started(t.id)).toMatchObject({ approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
    expect(approvals(t.id)[0].p.approval).toMatchObject({ tool: 'command', summary: 'touch codex-approved.txt' });
    expect(existsSync(file)).toBe(false);
    await answerQuestion(t.id, approvals(t.id)[0].p.id, [{ selected: ['Allow'], other: null }]);
    await r.untilResults(t.id, 1);
    expect(existsSync(file)).toBe(true);
    rmSync(file, { force: true });
  });

  // A quick ask's lock (packages/shared/quick-ask.ts readsOnly) and the channel's level are two layers: neither may
  // lift the other, so an ask in an Ask first or Full access channel still only reads, never asks and has no browser.
  it('keeps a quick ask read only, never asking and without a browser, whatever the level', async () => {
    const { startQuickAsk } = await import('../quick-ask.ts');
    for (const level of ['ask', 'full']) {
      setLevel(level);
      const t = await startQuickAsk({ channel: 'scratch', prompt: 'hi', harness: 'codex' });
      await r.untilResults(t.id, 1);
      const params = started(t.id);
      expect(params, level).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only' });
      expect(Object.keys(params.config).some((k) => k.startsWith('mcp_servers.omni-browser')), level).toBe(false);
    }
    setLevel(null);
  });

  it('keeps full access as before levels', async () => {
    setLevel('full');
    const t = await r.start('hi', { harness: 'codex' });
    await r.untilResults(t.id, 1);
    expect(started(t.id)).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    setLevel(null);
  });
});
