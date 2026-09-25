import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CURSOR } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
const cursor = { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' };
const turnFor = (id: string) => H.cursorRequests().find((r: any) => r.method === 'turn' && r.thread_id === id);

beforeAll(async () => {
  H = await startRunner({ OMNI_CURSOR_BIN: FAKE_CURSOR, OMNI_BROWSER: '1', PROBE_SECRET_TOKEN: 'topsecret-value', CURSOR_API_KEY: 'strip-me' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('cursor tools, secrets, attachments and crew reports', () => {
  it('loads Omni MCP servers from a per-thread plugin folder with no secret value', async () => {
    const t = await H.start('CMD hi', { ...cursor, role: 'conductor' });
    await H.untilResults(t.id, 1);
    const dir = turnFor(t.id).plugin_dir as string;
    expect(dir).toBeTruthy();

    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(Object.keys(mcp.mcpServers)).toContain('omni');
    expect(Object.keys(mcp.mcpServers)).toContain('omni-browser');
    const plugin = JSON.parse(readFileSync(join(dir, '.cursor-plugin', 'plugin.json'), 'utf8'));
    expect(plugin.name).toBe('omni-os');
    const raw = readFileSync(join(dir, '.mcp.json'), 'utf8') + readFileSync(join(dir, '.cursor-plugin', 'plugin.json'), 'utf8');
    expect(raw).not.toContain('topsecret-value');
  });

  it('carries secrets in the shell but never leaks a value or the Cursor api key', () => {
    const withProbe = H.cursorRequests().find((r: any) => Array.isArray(r.env_probe) && r.env_probe.length);
    expect(withProbe.env_probe).toContain('PROBE_SECRET_TOKEN');
    for (const r of H.cursorRequests()) expect(r.cursor_auth).toEqual([]);
    const all = H.cursorRequests().map((r: any) => JSON.stringify(r)).join('\n');
    expect(all).not.toContain('topsecret-value');
  });

  it('passes attachments as a path the agent can open', async () => {
    const txt = new File([Buffer.from('some notes')], 'notes.txt', { type: 'text/plain' });
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'read my notes', ...cursor, files: [txt] });
    await H.untilResults(t.id, 1);
    expect(turnFor(t.id).prompt).toContain('notes.txt');
  });

  it('ends the turn with the CLI error on a crash, and the next message resumes the chat', async () => {
    const t = await H.start('CRASH now', cursor);
    await H.untilStatus(t.id, 'failed', 12000);
    const chatId = H.thread(t.id).session_id;
    expect(chatId).toMatch(/^chat_/);

    H.runner.sendMessage(t.id, 'CMD carry on');
    await H.untilResults(t.id, 1, 12000);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.cursorRequests().filter((r: any) => r.method === 'turn' && r.thread_id === t.id).some((r: any) => r.resume === chatId)).toBe(true);
  });

  it('reports back to its parent as a crew report', async () => {
    const parent = await H.start('be my parent');
    await H.untilResults(parent.id, 1);
    const child = await H.start('CMD do the thing', { ...cursor, parent_id: parent.id, task_id: 'T-15' });
    await H.untilResults(child.id, 1);
    await H.until('parent received a crew report', () => H.byKind(parent.id, 'crew_report').length >= 1, 12000);
  });
});
