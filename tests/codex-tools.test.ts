import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_BROWSER: '1', PROBE_SECRET_TOKEN: 'topsecret-value' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('codex tools, secrets and crew reports', () => {
  it('loads Omni MCP servers, an inherit-all shell policy and ChatGPT login in the config overrides', async () => {
    const t = await H.start('CMD hello', { ...codex, role: 'conductor' });
    await H.untilResults(t.id, 1);
    const start = H.codexRequests().find((r) => r.method === 'thread/start');
    const cfg = start.params.config;
    expect(Object.keys(cfg.mcpServers)).toContain('omni'); // the conductor tools
    expect(Object.keys(cfg.mcpServers)).toContain('omni-browser');
    expect(cfg.shellEnvironmentPolicy.inherit).toBe('all');
    expect(cfg.preferredAuthMethod).toBe('chatgpt');
  });

  it('carries secrets in the environment but writes no secret value into any config', () => {
    const withProbe = H.codexRequests().find((r) => Array.isArray(r.env_probe) && r.env_probe.length);
    expect(withProbe.env_probe).toContain('PROBE_SECRET_TOKEN');
    const raw = H.codexRequests().map((r) => JSON.stringify(r)).join('\n');
    expect(raw).not.toContain('topsecret-value');
  });

  it('never leaks the OpenAI api-billing vars into the codex process', () => {
    for (const r of H.codexRequests()) expect(r.api_auth).toEqual([]);
  });

  it('reports back to its parent as a crew report', async () => {
    const parent = await H.start('be my parent');
    await H.untilResults(parent.id, 1);
    const child = await H.start('CMD do the thing', { ...codex, parent_id: parent.id, task_id: 'T-9' });
    await H.untilResults(child.id, 1);
    await H.until('parent received a crew report', () => H.byKind(parent.id, 'crew_report').length >= 1, 12000);
  });
});
