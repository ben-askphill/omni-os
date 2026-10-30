import { describe, it, expect, beforeAll } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CURSOR } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
const cursor = { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' };
const turnFor = (id: string) => H.cursorRequests().find((r: any) => r.method === 'turn' && r.thread_id === id);

// The user's Cursor config, so no test reads the real ~/.cursor: a permission list of theirs and a chats folder.
const userCursor = mkdtempSync(join(tmpdir(), 'omni-cursor-config-'));
mkdirSync(join(userCursor, 'chats'));
writeFileSync(join(userCursor, 'cli-config.json'), JSON.stringify({ version: 1, model: { modelId: 'x' }, permissions: { allow: ['Shell(ls)'], deny: ['Read(.env)'] } }));

beforeAll(async () => {
  H = await startRunner({ OMNI_CURSOR_BIN: FAKE_CURSOR, OMNI_BROWSER: '1', PROBE_SECRET_TOKEN: 'topsecret-value', CURSOR_API_KEY: 'strip-me', CURSOR_CONFIG_DIR: userCursor });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('cursor tools, secrets, attachments and crew reports', () => {
  it('loads Omni MCP servers from a per-thread plugin folder with no secret value', async () => {
    const t = await H.start('PARTIAL_OUTPUT CMD hi', { ...cursor, role: 'conductor' });
    await H.untilResults(t.id, 1);
    const dir = turnFor(t.id).plugin_dir as string;
    expect(turnFor(t.id).stream_partial).toBe(true);
    const replies = H.byKind(t.id, 'assistant_text').map((e) => String(e.p.text));
    expect(replies).toHaveLength(3);
    expect(replies.join('')).toContain('CMD hi');
    expect(dir).toBeTruthy();

    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(Object.keys(mcp.mcpServers)).toContain('omni');
    // The conductor is delegate-only: browser work goes to a crewmate, so it gets no browser.
    expect(Object.keys(mcp.mcpServers)).not.toContain('omni-browser');
    const plugin = JSON.parse(readFileSync(join(dir, '.cursor-plugin', 'plugin.json'), 'utf8'));
    expect(plugin.name).toBe('omni-os');
    const raw = readFileSync(join(dir, '.mcp.json'), 'utf8') + readFileSync(join(dir, '.cursor-plugin', 'plugin.json'), 'utf8');
    expect(raw).not.toContain('topsecret-value');
  });

  it('runs the delegate-only conductor under deny rules for shell and writes, in a config of its own', () => {
    const t = H.db.threads.list({}).find((x: any) => x.role === 'conductor' && x.harness === 'cursor')!;
    const dir = turnFor(t.id).cursor_config_dir as string;
    expect(dir).not.toBe(userCursor);
    const cfg = JSON.parse(readFileSync(join(dir, 'cli-config.json'), 'utf8'));
    // The user's settings and rules stay; Omni's deny rules are added, and deny beats --force.
    expect(cfg.model).toEqual({ modelId: 'x' });
    expect(cfg.permissions).toEqual({ allow: ['Shell(ls)'], deny: ['Read(.env)', 'Shell(*)', 'Write(**)'] });
    // The login, chats and sessions stay in the user's folder.
    expect(lstatSync(join(dir, 'chats')).isSymbolicLink()).toBe(true);
    // The user's own config is untouched.
    expect(JSON.parse(readFileSync(join(userCursor, 'cli-config.json'), 'utf8')).permissions.deny).toEqual(['Read(.env)']);
  });

  it('leaves a role that does the work on the user\'s own Cursor config', async () => {
    const t = await H.start('CMD hi', { ...cursor, role: 'builder' });
    await H.untilResults(t.id, 1);
    expect(turnFor(t.id).cursor_config_dir).toBe(userCursor);
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
