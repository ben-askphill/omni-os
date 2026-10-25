import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTEXT_JSON_MAX, newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { diffSelection, selectRows, type DiffSelection } from '@omni/shared/message-context-diff.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import { startRunner } from './runner-boot.ts';
import { diffFile, FAKE_CODEX, FAKE_CURSOR } from './support.ts';

// What each harness reads for the same record: Claude Code (stdin), Codex (turn/start input) and Cursor (the prompt
// argument) get the same block, byte for byte. The block is made when the message is written, so a queued message
// whose file changed while it waited says so, and the biggest records a message may carry stay within the block's bound.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let repo: string;
let record: MessageContext<string, DiffSelection>;
const T = { timeout: 30_000 };
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };
const cursor = { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' };
const EDITED = 'export function total(items: number[]) {\n  return items.reduce((sum, n) => sum + n, 0);\n}\n';

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
  await (await import('../harness/catalog-service.ts')).loadCatalog();
  ({ app } = await import('../app.ts'));
  repo = mkdtempSync(join(tmpdir(), 'omni-context-harness-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export function total(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}\n');
  git('add', '.');
  git('commit', '-q', '-m', 'cart');
  writeFileSync(join(repo, 'src', 'cart.ts'), EDITED);
  H.db.channels.create({ id: 'ctx', name: 'Context', kind: 'internal', use_worktree: 0, repo_path: repo, base_dir: repo });
  const t = await H.runner.createThread({ channel: 'ctx', prompt: 'hello' });
  await H.untilResults(t.id, 1);
  const changes = await (await app.request(`/api/threads/${t.id}/changes`)).json();
  const file = changes.groups.find((g: any) => g.kind === 'unstaged').files[0];
  const body = selectRows(diffFile(file), 1, 4, { group: 'unstaged', from: changes.base.sha, to: changes.head, turn: null });
  if (!body.ok) throw new Error(body.error);
  record = newContext(diffSelection, body.value, 'this reduce reads better with names');
});

const post = async (id: string, body: Record<string, unknown>) => {
  const res = await app.request(`/api/threads/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json() as Promise<any>;
};
const block = (text: string) => {
  const from = text.indexOf('<omni-context>');
  const to = text.indexOf('</omni-context>');
  expect(from, text).toBeGreaterThanOrEqual(0);
  return text.slice(from, to + '</omni-context>'.length);
};
/** The text of the last message each harness was handed for a thread. */
const received = {
  claude: (id: string) => H.claudeTexts(id).at(-1)!,
  codex: (id: string) => H.codexRequests().filter((r) => r.method === 'turn/start' && r.thread_id === id).at(-1).params.input.find((i: any) => i.type === 'text').text as string,
  cursor: (id: string) => H.cursorRequests().filter((r) => r.method === 'turn' && r.thread_id === id).at(-1).prompt as string,
};

describe('context for each harness', () => {
  it('gives Claude Code, Codex and Cursor the same block for the same record', T, async () => {
    const threads = {
      claude: await H.runner.createThread({ channel: 'ctx', prompt: 'CMD hi' }),
      codex: await H.runner.createThread({ channel: 'ctx', prompt: 'CMD hi', ...codex }),
      cursor: await H.runner.createThread({ channel: 'ctx', prompt: 'CMD hi', ...cursor }),
    };
    for (const t of Object.values(threads)) await H.untilResults(t.id, 1);
    for (const t of Object.values(threads)) await post(t.id, { prompt: 'tidy this reduce', context: [record] });
    for (const t of Object.values(threads)) await H.untilResults(t.id, 2);

    const blocks = Object.entries(threads).map(([harness, t]) => block(received[harness as keyof typeof received](t.id)));
    expect(blocks[0]).toContain('Check: current.');
    expect(blocks[0]).toContain('File: src/cart.ts, relative to your working directory.');
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[2]).toBe(blocks[0]);
    for (const [harness, t] of Object.entries(threads)) expect(received[harness as keyof typeof received](t.id).startsWith('tidy this reduce\n\n<omni-context>'), harness).toBe(true);
  });

  it('checks the file when a queued message is written, not when it was accepted', T, async () => {
    const t = await H.runner.createThread({ channel: 'ctx', prompt: 'TOOL:2000 work' });
    await H.untilTool(t.id);
    const queued = await post(t.id, { prompt: 'then this', mode: 'queue', context: [record] });
    expect(queued.request.state).toBe('held');
    // The turn it waits behind rewrites the selected lines.
    writeFileSync(join(repo, 'src', 'cart.ts'), EDITED.replace('sum + n', 'n + sum'));
    await H.untilResults(t.id, 2);
    const text = received.claude(t.id);
    expect(text.startsWith('then this')).toBe(true);
    expect(block(text)).toContain('Check: STALE: these lines changed since they were selected; read the file before acting.');
    expect(H.byKind(t.id, 'user').at(-1)!.p.context[0].body.rows).toEqual(record.body.rows);
    writeFileSync(join(repo, 'src', 'cart.ts'), EDITED);
  });

  it('keeps the biggest context a message may carry within CONTEXT_BLOCK_MAX', T, async () => {
    const { CONTEXT_BLOCK_MAX } = await import('../message-context/project.ts');
    const path = `${'deep/'.repeat(199)}cart.ts`;
    const make = (chars: number) =>
      Array.from({ length: 8 }, (_, i) => ({
        ...record,
        id: `big-${i}`,
        note: 'n'.repeat(2000),
        body: { ...record.body, path, start: 1, end: 2, rows: [0, 1].map((k) => ({ kind: 'add', text: '`'.repeat(chars), old: null, new: k + 1 })) },
      }));
    // As much as the route takes: the most backticks per row that keep the records within CONTEXT_JSON_MAX.
    let chars = 500;
    for (let ok = parseContexts(make(chars)); !ok.ok; ok = parseContexts(make(--chars))) expect(ok.error).toMatch(/longer than 32000 characters/);
    const most = parseContexts(make(chars));
    expect(most.ok && JSON.stringify(most.value).length).toBeGreaterThan(CONTEXT_JSON_MAX - 20);

    const t = await H.runner.createThread({ channel: 'ctx', prompt: 'hello' });
    await H.untilResults(t.id, 1);
    await post(t.id, { prompt: 'all of these', context: make(chars) });
    await H.untilResults(t.id, 2);
    const sent = block(received.claude(t.id));
    expect(sent.length).toBeLessThanOrEqual(CONTEXT_BLOCK_MAX);
    expect(sent).toContain('the user attached 8 items from Omni');
    expect(sent).toMatch(/\n\[\d(-8)?\] … \d more items? not shown\n<\/omni-context>$/);
    expect(H.byKind(t.id, 'user').at(-1)!.p.context).toHaveLength(8);
  });
});
