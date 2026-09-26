import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';
import type { CrewRole } from '../server/crew.ts';
import type { ThreadStartResponse } from '../server/harness/codex/protocol.ts';

// Omni against the Codex CLI it really runs. The fake in fixtures/ speaks protocol.ts, so only
// this catches a Codex upgrade that changed the protocol. It needs `codex login`, spends two
// short turns of the plan and leaves one thread in Codex's history, so it only runs on request:
//   OMNI_LIVE_CODEX=1 npx vitest run --config tests/vitest.config.ts tests/codex-live.test.ts
const LIVE = process.env.OMNI_LIVE_CODEX === '1';

// keepalive 0 closes the app-server after each turn, so the follow-up is a thread/resume.
const H = LIVE ? await startRunner({ OMNI_KEEPALIVE_SECONDS: '0', OMNI_BROWSER: '1' }) : null!;
const svc = LIVE ? await import('../server/harness/catalog-service.ts') : null!;
const usage = LIVE ? await import('../server/usage.ts') : null!;

describe.skipIf(!LIVE)('the real codex-cli', () => {
  it('reports the ChatGPT login, the models with their efforts, and the plan usage', async () => {
    const probe = await svc.probeCodex();
    expect(probe.available).toBe(true);
    expect(probe.models.length).toBeGreaterThan(0);
    for (const m of probe.models) expect(m.efforts).toContain(m.defaultEffort);
    expect(probe.rateLimits).toMatchObject({ limitId: 'codex', primary: { usedPercent: expect.any(Number) } });
  }, 30_000);

  it("starts Omni's MCP servers from the config keys it sends", async () => {
    const { CodexClient } = await import('../server/harness/codex/client.ts');
    const { codexBin } = await import('../server/harness/codex/bin.ts');
    const { threadConfig } = await import('../server/harness/codex/adapter.ts');
    const { buildMcpConfig } = await import('../server/sandbox.ts');
    const { harnessEnv } = await import('../server/harness/env-guard.ts');
    const { mcpServers } = buildMcpConfig({
      threadId: 'live-mcp',
      channel: H.db.channels.get('scratch')!,
      role: { mcp: ['omni'] } as CrewRole,
      browserBusy: true,
      omniUrl: 'http://127.0.0.1:9',
    });
    const names = Object.keys(mcpServers);
    expect([...names].sort()).toEqual(['omni', 'omni-browser']);

    const client = new CodexClient({ bin: codexBin()!, env: harnessEnv('codex', {}), cwd: H.tmp });
    try {
      await client.request('initialize', { clientInfo: { name: 'omni-os', version: '0.1.0' } });
      client.notify('initialized', {});
      // Ephemeral, and no turn: nothing is saved or spent.
      const { thread } = await client.request<ThreadStartResponse>('thread/start', {
        cwd: H.tmp,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
        ephemeral: true,
        config: threadConfig(mcpServers),
      });
      type Page = { data: { name: string; runtimeStatus: string | null }[]; nextCursor: string | null };
      // The servers start in the background; poll until both are up.
      const seen: Record<string, string | null> = {};
      const end = Date.now() + 60_000;
      for (;;) {
        let cursor: string | null = null;
        do {
          const page: Page = await client.request<Page>('mcpServerStatus/list', { threadId: thread.id, cursor, detail: 'toolsAndAuthOnly' });
          for (const s of page.data) if (names.includes(s.name)) seen[s.name] = s.runtimeStatus;
          cursor = page.nextCursor;
        } while (cursor);
        if (names.every((n) => seen[n] === 'connected') || Date.now() > end) break;
        await sleep(500);
      }
      expect(seen).toEqual({ omni: 'connected', 'omni-browser': 'connected' });
    } finally {
      client.kill();
    }
  }, 90_000);

  it('runs a turn with a shell command, then resumes the thread for a follow-up', async () => {
    const codex = (await svc.freshCatalog()).harnesses.find((h) => h.id === 'codex')!;
    const model = codex.models.find((m) => m.default) ?? codex.models[0];
    const effort = model.efforts.includes('low') ? 'low' : model.efforts[0];
    const t = await H.start('Run the shell command `echo omni-live`, then reply with just the word done.', {
      harness: 'codex',
      model: model.id,
      effort,
    });
    await H.untilResults(t.id, 1, 180_000);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.byKind(t.id, 'error')).toEqual([]);
    const bash = H.byKind(t.id, 'tool_use').find((e) => e.p.name === 'Bash');
    expect(bash?.p.input.command).toContain('echo omni-live');
    expect(H.byKind(t.id, 'tool_result').find((e) => e.p.tool_use_id === bash!.p.id)?.p.text).toContain('omni-live');
    expect(H.texts(t.id, 'assistant_text').join('\n')).toMatch(/done/i);
    expect(usage.usageFor('codex')?.five_hour?.utilization).toEqual(expect.any(Number));

    await H.until('warm process closed', () => !H.runner.isLive(t.id), 30_000);
    H.runner.sendMessage(t.id, 'What did that command print? Reply with just its output.');
    await H.untilResults(t.id, 2, 180_000);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.byKind(t.id, 'error')).toEqual([]);
    expect(H.texts(t.id, 'assistant_text').at(-1)).toMatch(/omni-live/);
  }, 420_000);
});
