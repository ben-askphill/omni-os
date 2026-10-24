import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newContext, type MessageContext } from '@omni/shared/message-context.ts';
import { diffSelection, selectRows } from '@omni/shared/message-context-diff.ts';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import { startRunner } from './runner-boot.ts';
import { diffFile } from './support.ts';

// Typed message context through the HTTP routes, the real runner and the fake claude CLI: a diff selection made with
// selectRows from a real repo's /changes, saved on the request, kept as sent in the transcript and the pending rows,
// and quoted to the harness. The record never changes after the route, whatever happens to the file.

let h: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let repo: string;
const T = { timeout: 30_000 };
const ORIGINAL = 'export function total(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}\n';
const EDITED = 'export function total(items: number[]) {\n  return items.reduce((sum, n) => sum + n, 0);\n}\n';

beforeAll(async () => {
  h = await startRunner();
  ({ app } = await import('../app.ts'));
  repo = mkdtempSync(join(tmpdir(), 'omni-context-repo-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'cart.ts'), ORIGINAL);
  git('add', '.');
  git('commit', '-q', '-m', 'cart');
  writeFileSync(join(repo, 'src', 'cart.ts'), EDITED);
  h.db.channels.create({ id: 'ctx', name: 'Context', kind: 'internal', use_worktree: 0, repo_path: repo, base_dir: repo });
});

const call = async (method: string, path: string, body?: unknown, files: File[] = []) => {
  let init: RequestInit = { method };
  if (files.length) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(body ?? {}));
    for (const f of files) fd.append('files', f, f.name);
    init.body = fd;
  } else if (body !== undefined) init = { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await app.request(`/api${path}`, init);
  return { status: res.status, body: (await res.json()) as any };
};
const post = (id: string, body: Record<string, unknown>, files: File[] = []) => call('POST', `/threads/${id}/messages`, body, files);
const write = (text: string) => writeFileSync(join(repo, 'src', 'cart.ts'), text);
const normalized = (records: unknown[]): MessageContext[] => {
  const parsed = parseContexts(records);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
const users = (id: string) => h.byKind(id, 'user').map((e) => e.p);

/** A thread in the repo's channel that has finished its first turn. */
async function thread(prompt = 'hello') {
  const t = await h.runner.createThread({ channel: 'ctx', prompt });
  if (!prompt.startsWith('TOOL')) await h.untilResults(t.id, 1);
  return t;
}

/** Ben's pick in the Changes panel: src/cart.ts's unstaged hunk, every row. */
async function selection(threadId: string, note = 'this reduce reads better with names') {
  const changes = (await call('GET', `/threads/${threadId}/changes`)).body;
  const file = changes.groups.find((g: any) => g.kind === 'unstaged').files.find((f: any) => f.path === 'src/cart.ts');
  const body = selectRows(diffFile(file), 1, 4, { group: 'unstaged', from: changes.base.sha, to: changes.head, turn: null });
  if (!body.ok) throw new Error(body.error);
  return newContext(diffSelection, body.value, note);
}

describe('a message with context', () => {
  it('saves the record on the request, keeps it as sent in the transcript, and quotes it to the harness', T, async () => {
    const t = await thread();
    const record = await selection(t.id);
    expect(record.body).toMatchObject({ path: 'src/cart.ts', side: 'new', start: 1, end: 3, source: { group: 'unstaged', turn: null } });
    expect(record.body.source.blob_old).toMatch(/^[0-9a-f]{7,}$/);
    const want = normalized([record]);
    // The file moves on before the message is sent: two lines added above the selection.
    write(`// cart\n\n${EDITED}`);

    const res = await post(t.id, { prompt: 'tidy this reduce', context: [record], request_id: 'ctx-1' });
    expect(res.status).toBe(200);
    expect(h.db.messageRequests.get(res.body.request.id)!.context).toEqual(want);
    await h.untilResults(t.id, 2);

    const sent = users(t.id).at(-1);
    expect(sent).toMatchObject({ text: 'tidy this reduce', source: 'ben' });
    expect(sent.context).toEqual(want);
    const harness = h.claudeTexts(t.id).at(-1)!;
    expect(harness.startsWith('tidy this reduce\n\n<omni-context>\n')).toBe(true);
    expect(harness).toContain('[1] Diff selection in src/cart.ts, new lines 1-3 (unstaged)\nFile: src/cart.ts, relative to your working directory.\nCheck: moved to lines 3-5.');
    expect(harness).toContain('```diff\n export function total(items: number[]) {\n-  return items.reduce((a, b) => a + b, 0);\n+  return items.reduce((sum, n) => sum + n, 0);\n }\n```\n</omni-context>');

    // Changed again after it was read: the record stays as Ben sent it, in the transcript and on the request.
    write('export const total = (items: number[]) => items.length;\n');
    const detail = (await call('GET', `/threads/${t.id}`)).body;
    expect(JSON.parse(detail.events.filter((e: any) => e.kind === 'user').at(-1).payload).context).toEqual(want);
    expect((await call('GET', `/threads/${t.id}/requests`)).body.find((r: any) => r.request_id === 'ctx-1')).toMatchObject({ state: 'delivered', context: want });
    write(EDITED);
  });

  it('answers a retry with the same context as a duplicate, and refuses the same id with other context', T, async () => {
    const t = await thread();
    const record = await selection(t.id);
    const first = await post(t.id, { prompt: 'look here', context: [record], request_id: 'ctx-retry' });
    // The same record with its keys in another order is the same message.
    const shuffled = { body: record.body, note: record.note, label: 'whatever the client says', v: record.v, kind: record.kind, id: record.id };
    const again = await post(t.id, { prompt: 'look here', context: [shuffled], request_id: 'ctx-retry' });
    expect(again.body.request).toMatchObject({ id: first.body.request.id, duplicate: true });
    const other = await post(t.id, { prompt: 'look here', context: [{ ...record, note: 'a different note' }], request_id: 'ctx-retry' });
    expect(other.status).toBe(409);
    expect(other.body.error).toMatch(/already used for a different message/);
    // Context is part of the message: the same words without it are another message too.
    expect((await post(t.id, { prompt: 'look here', request_id: 'ctx-retry' })).status).toBe(409);
    await h.untilResults(t.id, 2);
    expect(users(t.id).filter((u) => u.text === 'look here')).toHaveLength(1);
  });

  it('refuses unknown kinds, newer versions and bad records, naming the problem, and saves nothing', T, async () => {
    const t = await thread();
    const record = await selection(t.id);
    const before = h.db.messageRequests.forThread(t.id).length;
    const refused = async (context: unknown) => {
      const res = await post(t.id, { prompt: 'look', context });
      expect(res.status).toBe(400);
      return res.body.error as string;
    };
    expect(await refused([{ ...record, kind: 'future_kind' }])).toBe('context[0].kind "future_kind" is not one this Omni knows');
    expect(await refused([{ ...record, v: 2 }])).toBe('context[0].v 2 is newer than this Omni reads (diff_selection v1)');
    expect(await refused([{ ...record, body: { ...record.body, path: '../secrets.txt' } }])).toMatch(/^context\[0\]\.body: path must be relative/);
    expect(await refused([record, record])).toBe("context[1].id repeats an earlier record's id");
    expect(await refused('not a list')).toMatch(/^context must be a list/);
    expect(h.db.messageRequests.forThread(t.id)).toHaveLength(before);
  });

  it('sends context without words, but not an empty message', T, async () => {
    const t = await thread();
    const record = await selection(t.id, '');
    const empty = await post(t.id, { prompt: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Write a message or add context to send.');
    expect((await post(t.id, { prompt: '', context: [] })).status).toBe(400);
    expect((await post(t.id, { prompt: '', context: [record] })).status).toBe(200);
    await h.untilResults(t.id, 2);
    expect(users(t.id).at(-1)).toMatchObject({ text: '', context: normalized([record]) });
    const harness = h.claudeTexts(t.id).at(-1)!;
    expect(harness.startsWith('<omni-context>\n')).toBe(true);
    expect(harness).not.toContain('note:');
  });

  it('keeps a file and context together in a multipart send', T, async () => {
    const t = await thread();
    const record = await selection(t.id);
    const res = await post(t.id, { prompt: 'see both', context: [record], request_id: 'ctx-file' }, [new File(['cart notes'], 'notes.txt', { type: 'text/plain' })]);
    expect(res.status).toBe(200);
    await h.untilResults(t.id, 2);
    const sent = users(t.id).at(-1);
    expect(sent.attachments.map((a: any) => a.name)).toEqual(['notes.txt']);
    expect(sent.context).toEqual(normalized([record]));
    const harness = h.claudeTexts(t.id).at(-1)!;
    expect(harness.indexOf('</omni-context>')).toBeGreaterThan(0);
    expect(harness.indexOf('## Attachments')).toBeGreaterThan(harness.indexOf('</omni-context>'));
  });

  it('shows context on a queued message, keeps it through an edit, and sends it after the turn', T, async () => {
    const record = await selection((await thread()).id);
    const t = await thread('TOOL:2500 work');
    await h.untilTool(t.id);
    const want = normalized([record]);
    const queued = await post(t.id, { prompt: 'after this', mode: 'queue', context: [record], request_id: 'ctx-held' });
    expect(queued.body.request.state).toBe('held');
    const plain = await post(t.id, { prompt: 'no context', mode: 'queue', request_id: 'ctx-plain' });
    const pending = (await call('GET', `/threads/${t.id}`)).body.pending;
    expect(pending.find((p: any) => p.request_id === 'ctx-held').context).toEqual(want);
    expect(pending.find((p: any) => p.request_id === 'ctx-plain').context).toBeUndefined();

    const id = queued.body.request.id;
    const edited = await call('PATCH', `/threads/${t.id}/requests/${id}`, { prompt: '' });
    expect(edited.status).toBe(200);
    expect(edited.body.request).toMatchObject({ prompt: '', context: want });
    expect(edited.body.pending.find((p: any) => p.uuid === id)).toMatchObject({ text: '', context: want });
    const words = await call('PATCH', `/threads/${t.id}/requests/${id}`, { prompt: 'edited words' });
    expect(words.body.request).toMatchObject({ prompt: 'edited words', context: want });
    // Without context a message still needs words.
    const blank = await call('PATCH', `/threads/${t.id}/requests/${plain.body.request.id}`, { prompt: '' });
    expect(blank.status).toBe(400);

    await h.untilResults(t.id, 3);
    expect(users(t.id).find((u) => u.text === 'edited words')?.context).toEqual(want);
    expect(h.claudeTexts(t.id).find((x) => x.startsWith('edited words'))).toContain('<omni-context>');
  });
});
