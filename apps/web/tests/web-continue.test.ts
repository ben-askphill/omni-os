import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Carryover, CarryoverAttachment, ContinueLink, ContinuePreview } from '@omni/shared/continue.ts';
import { ApiError, type HarnessWithRunning, type Thread } from '../src/api.ts';
import { ContinueCrumbs, MoContinueLinks } from '../src/components/ContinueLinks.tsx';
import { BlockNote } from '../src/components/ContinueSheet.tsx';
import { threadView } from '../src/mobile/thread-view.ts';
import { buildItems, type TranscriptEvent } from '../src/transcript/fold.ts';
import {
  NO_LINKS,
  attachmentRows,
  attachmentsSummary,
  blockOf,
  canStart,
  closesTerminal,
  continueReducer,
  continueTargets,
  defaultRun,
  initContinue,
  linksWith,
  newestLink,
  previewSections,
  refusalText,
  sizeLine,
  slashHint,
  sourceRefusal,
  startBody,
  startError,
  workspaceText,
  type ContinueState,
} from '../src/continue.ts';

// Continuing an idle thread on another local harness (apps/web/src/continue.ts): what the sheet offers, the run it opens
// on, how a Start is retried and refused, the preview's sections, and the links both threads show.

const model = (id: string, isDefault = false) => ({ id, label: id.toUpperCase(), efforts: ['low', 'high'], defaultEffort: 'high', default: isDefault });
const harness = (id: string, available = true, fix?: string) =>
  ({ id, name: id, plan: 'plan', available, fix, models: [model(`${id}-a`), model(`${id}-b`, true)], running: 0 }) as unknown as HarnessWithRunning;

const CATALOG = [harness('claude-code'), harness('codex'), harness('cursor', false, 'cursor-agent login'), harness('hermes'), harness('cursor-cloud')];

const carryover = (over: Partial<Carryover> = {}): Carryover => ({
  source: { id: 'src', title: 'Fix the flaky test', channel: 'omni-os', run: { harness: 'claude-code', model: '', effort: '', harnessName: 'Claude Code', modelLabel: 'Opus' } },
  to: { harness: 'codex', model: 'codex-b', effort: '', harnessName: 'Codex', modelLabel: 'CODEX-B' },
  goal: 'Make the sync test pass on CI',
  constraints: ['Work in /repo/worktree', 'Do not push'],
  files: null,
  checks: [],
  recent: [],
  attachments: [],
  omitted: [],
  budget: 24_000,
  chars: 12_300,
  text: '<omni-carryover>…</omni-carryover>',
  ...over,
});

const preview = (revision: string, over: Partial<ContinuePreview> = {}): ContinuePreview => ({ carryover: carryover(), revision, workspace: 'worktree', blocked: null, ...over });

const CODEX = { harness: 'codex', model: 'codex-b', effort: '' };
const CLAUDE = { harness: 'claude-code', model: 'claude-code-b', effort: '' };

const ready = (over: Partial<ContinueState> = {}): ContinueState => ({ ...initContinue(CODEX), preview: { kind: 'ready', preview: preview('r1') }, text: 'Carry on', ...over });

describe('which harnesses the sheet offers', () => {
  it('offers every local harness, an unavailable one with its fix, and lists the remote ones with why not', () => {
    const t = continueTargets(CATALOG);
    expect(t.offered.map((h) => h.id)).toEqual(['claude-code', 'codex', 'cursor']);
    expect(t.offered.find((h) => h.id === 'cursor')).toMatchObject({ available: false, fix: 'cursor-agent login' });
    expect(t.refused.map((r) => r.id)).toEqual(['hermes', 'cursor-cloud']);
    expect(t.refused[0]!.reason).toMatch(/^Hermes runs on its own server/);
    expect(t.refused[1]!.reason).toMatch(/^Cursor Cloud works on its own clone/);
  });

  it('opens on the first ready local harness other than the source, at its default model and effort', () => {
    const { offered } = continueTargets(CATALOG);
    expect(defaultRun(offered, 'claude-code')).toEqual({ harness: 'codex', model: 'codex-b', effort: '' });
    expect(defaultRun(offered, 'codex')).toEqual({ harness: 'claude-code', model: 'claude-code-b', effort: '' });
  });

  it("falls back to the source's own harness when it is the only one ready, and to nothing when none is", () => {
    expect(defaultRun([harness('claude-code'), harness('codex', false)], 'claude-code')).toEqual(CLAUDE);
    expect(defaultRun([harness('codex', false)], 'claude-code')).toBeNull();
  });

  it('offers no continuing for a remote thread, and says why', () => {
    expect(sourceRefusal('hermes')).toMatch(/not on this Mac/);
    expect(sourceRefusal('cursor-cloud')).toMatch(/not on this Mac/);
    for (const h of ['claude-code', 'codex', 'cursor']) expect(sourceRefusal(h)).toBeNull();
  });
});

describe('the Start request', () => {
  let n = 0;
  const make = () => `id-${++n}`;

  it("sends the run, Ben's message and the preview's revision", () => {
    const { body } = startBody({ harness: 'codex', model: 'codex-b', effort: 'high' }, '  Carry on  ', 'r1', null, make);
    expect(body).toEqual({ harness: 'codex', model: 'codex-b', effort: 'high', attachments: [], text: 'Carry on', revision: 'r1', request_id: expect.any(String) });
  });

  it('reuses the request id when Ben retries the same Start, so the server answers with the same thread', () => {
    const first = startBody(CODEX, 'Carry on', 'r1', null, make);
    const retry = startBody(CODEX, 'Carry on', 'r1', first.attempt, make);
    expect(retry.body.request_id).toBe(first.body.request_id);
  });

  it('takes a new id once the message, the run or the preview changes', () => {
    const first = startBody(CODEX, 'Carry on', 'r1', null, make);
    expect(startBody(CODEX, 'Carry on, and add a test', 'r1', first.attempt, make).body.request_id).not.toBe(first.body.request_id);
    expect(startBody(CLAUDE, 'Carry on', 'r1', first.attempt, make).body.request_id).not.toBe(first.body.request_id);
    expect(startBody(CODEX, 'Carry on', 'r2', first.attempt, make).body.request_id).not.toBe(first.body.request_id);
  });

  it("reads a refused Start's 409 body", () => {
    const fresh = preview('r2');
    expect(startError(new ApiError('changed', 409, { error: 'changed', code: 'changed', preview: fresh }))).toEqual({ kind: 'changed', preview: fresh });
    const block = { code: 'running', message: 'A turn is running in it.' };
    expect(startError(new ApiError('busy', 409, { error: 'busy', code: 'busy', block }))).toEqual({ kind: 'busy', block });
    expect(startError(new ApiError('That request id was used for another start.', 409, { code: 'request_reused' }))).toEqual({
      kind: 'reused',
      error: 'That request id was used for another start.',
    });
    expect(startError(new ApiError('Pick a local harness.', 400, { error: 'Pick a local harness.' }))).toEqual({ kind: 'error', error: 'Pick a local harness.' });
    expect(startError(new ApiError('Cannot reach the Omni server. Is it running?', 0))).toEqual({ kind: 'error', error: 'Cannot reach the Omni server. Is it running?' });
  });
});

const file = (over: Partial<CarryoverAttachment> = {}): CarryoverAttachment => ({
  id: 'u1:0', name: 'shot.png', event_id: 2, mime: 'image/png', size: 3_400, image: true, availability: 'available', reason: null, selected: false, carried: false, as: 'inline', ...over,
});

describe('attachments', () => {
  it('shows each file with its type, size and how it arrives, and lets only an available one be ticked', () => {
    const rows = attachmentRows(
      carryover({
        attachments: [
          file({ selected: true, carried: true }),
          file({ id: 'u1:1', name: 'notes.txt', mime: 'text/plain', size: 10, image: false, as: 'path' }),
          file({ id: 'u1:2', name: 'photo.jpg', mime: 'image/jpeg', as: 'path' }),
          file({ id: 'u1:3', name: 'trace.zip', mime: 'application/zip', size: null, image: false, availability: 'missing', reason: 'Its bytes are not on this Mac.', selected: true, as: null }),
          file({ id: 'u1:4', name: 'big.mov', mime: 'video/quicktime', size: 90_000_000, image: false, availability: 'oversize', reason: '85.8 MB is over the 25 MB limit for one file.', as: null }),
          file({ id: 'u1:5', name: 'link', mime: 'application/octet-stream', availability: 'unsupported', reason: 'It is a link, not a file.', as: null }),
        ],
      }),
    );
    expect(rows.map((r) => [r.name, r.meta, r.note, r.tag, r.selected, r.selectable])).toEqual([
      ['shot.png', 'PNG image · 3.3 KB', 'Goes inline as an image.', null, true, true],
      ['notes.txt', 'Text · 10 B', null, null, false, true],
      ['photo.jpg', 'JPEG image · 3.3 KB', null, null, false, true],
      ['trace.zip', 'File · size unknown', 'Its bytes are not on this Mac.', 'Missing', false, false],
      ['big.mov', 'File · 85.8 MB', '85.8 MB is over the 25 MB limit for one file.', 'Too big', false, false],
      ['link', 'File · 3.3 KB', 'It is a link, not a file.', 'Not a file', false, false],
    ]);
  });

  it('says how a ticked file arrives, and that a harness without inline images takes an image by path', () => {
    const [shot, photo] = attachmentRows(
      carryover({ attachments: [file({ selected: true, carried: true, as: 'path' }), file({ id: 'u1:1', name: 'photo.jpg', mime: 'image/jpeg', selected: true, carried: true, as: 'path', image: true })] }),
    );
    expect(shot.note).toBe('Goes as a path to the file. This harness does not show images inline.');
    expect(photo.note).toBe('Goes as a path to the file. This harness does not show images inline.');
    expect(attachmentRows(carryover({ attachments: [file({ id: 'u1:2', name: 'notes.txt', mime: 'text/plain', image: false, selected: true, carried: true, as: 'path' })] }))[0].note).toBe('Goes as a path to the file.');
  });

  it('counts what will be copied', () => {
    expect(attachmentsSummary(carryover({ attachments: [file(), file({ id: 'u1:1' })] }))).toBe('None will be carried. Tick the ones the new thread needs.');
    expect(attachmentsSummary(carryover({ attachments: [file({ carried: true, selected: true }), file({ id: 'u1:1' })] }))).toBe('1 of 2 will be copied into the new thread.');
  });

  it('asks for a new preview with each tick and drops one that answers other picks', () => {
    let s = continueReducer(initContinue(CODEX), { type: 'previewed', run: CODEX, picked: [], preview: preview('r1') });
    s = continueReducer(s, { type: 'attach', id: 'u1:0' });
    expect(s).toMatchObject({ picked: ['u1:0'], preview: { kind: 'loading', last: preview('r1') } });
    expect(continueReducer(s, { type: 'previewed', run: CODEX, picked: [], preview: preview('stale') })).toBe(s);
    expect(continueReducer(s, { type: 'previewFailed', run: CODEX, picked: [], error: 'gone' })).toBe(s);
    s = continueReducer(s, { type: 'previewed', run: CODEX, picked: ['u1:0'], preview: preview('r2') });
    expect(s.preview).toEqual({ kind: 'ready', preview: preview('r2') });
    s = continueReducer(s, { type: 'attach', id: 'u1:1' });
    expect(continueReducer(s, { type: 'attach', id: 'u1:0' }).picked).toEqual(['u1:1']);
    expect(continueReducer(s, { type: 'pick', run: CLAUDE }).picked, 'a new run keeps the picks').toEqual(['u1:0', 'u1:1']);
  });

  it('sends the picks, and a retry of the same picks reuses its request id while other picks get a new one', () => {
    const run = CODEX;
    const one = startBody(run, 'go', 'r1', null, () => 'id-a', ['u1:1', 'u1:0']);
    expect(one.body).toMatchObject({ attachments: ['u1:0', 'u1:1'], request_id: 'id-a' });
    expect(startBody(run, 'go', 'r1', one.attempt, () => 'id-b', ['u1:0', 'u1:1']).body.request_id).toBe('id-a');
    expect(startBody(run, 'go', 'r1', one.attempt, () => 'id-b', ['u1:0']).body.request_id).toBe('id-b');
  });
});

describe('the sheet', () => {
  it('asks for a preview of the run it opens on, and of every run Ben picks, keeping the last one on screen', () => {
    let s = initContinue(CODEX);
    expect(s.preview).toEqual({ kind: 'loading', last: null });
    s = continueReducer(s, { type: 'previewed', run: CODEX, picked: [], preview: preview('r1') });
    expect(s.preview).toEqual({ kind: 'ready', preview: preview('r1') });
    s = continueReducer(s, { type: 'pick', run: CLAUDE });
    expect(s).toMatchObject({ run: CLAUDE, preview: { kind: 'loading', last: preview('r1') } });
    expect(continueReducer(s, { type: 'pick', run: CLAUDE })).toBe(s);
  });

  it('drops a preview that answers a run Ben has since changed', () => {
    const s = continueReducer(initContinue(CODEX), { type: 'pick', run: CLAUDE });
    expect(continueReducer(s, { type: 'previewed', run: CODEX, picked: [], preview: preview('old') })).toBe(s);
    expect(continueReducer(s, { type: 'previewFailed', run: CODEX, picked: [], error: 'gone' })).toBe(s);
    expect(continueReducer(s, { type: 'previewFailed', run: CLAUDE, picked: [], error: 'Thread not found' }).preview).toEqual({ kind: 'failed', error: 'Thread not found' });
  });

  it('starts only with a ready preview, an idle source and a message, once at a time', () => {
    expect(canStart(ready())).toBe(true);
    expect(canStart(ready({ text: '   ' }))).toBe(false);
    expect(canStart(ready({ posting: true }))).toBe(false);
    expect(canStart(ready({ run: null }))).toBe(false);
    expect(canStart(ready({ preview: { kind: 'loading', last: preview('r1') } }))).toBe(false);
    const blocked = ready({ preview: { kind: 'ready', preview: preview('r1', { blocked: { code: 'queued', message: 'Messages wait to run in it.' } }) } });
    expect(blockOf(blocked)).toEqual({ code: 'queued', message: 'Messages wait to run in it.' });
    expect(canStart(blocked)).toBe(false);
  });

  it("swaps in the fresh preview when the thread changed, keeps Ben's text, and says to check it", () => {
    const fresh = preview('r2');
    let s = continueReducer(ready(), { type: 'posting', attempt: { key: 'k', id: 'id-1' } });
    s = continueReducer(s, { type: 'refused', error: { kind: 'changed', preview: fresh } });
    expect(s).toMatchObject({ posting: false, text: 'Carry on', preview: { kind: 'ready', preview: fresh } });
    expect(refusalText(s.refusal)).toBe('This thread changed since the preview. Check the new one.');
    expect(canStart(s)).toBe(true);
    expect(startBody(s.run!, s.text, fresh.revision, s.attempt).body.request_id).not.toBe('id-1');
  });

  it('holds Start back while the source is busy, until a fresh look finds it idle', () => {
    const block = { code: 'running' as const, message: 'A turn is running in it.' };
    let s = continueReducer(ready(), { type: 'posting', attempt: { key: 'k', id: 'id-1' } });
    s = continueReducer(s, { type: 'refused', error: { kind: 'busy', block } });
    expect(blockOf(s)).toEqual(block);
    expect(canStart(s)).toBe(false);
    expect(refusalText(s.refusal)).toBeNull();
    s = continueReducer(s, { type: 'recheck' });
    expect(s).toMatchObject({ asked: 1, refusal: null, preview: { kind: 'loading', last: preview('r1') } });
    s = continueReducer(s, { type: 'previewed', run: CODEX, picked: [], preview: preview('r2') });
    expect(canStart(s)).toBe(true);
  });

  it('offers to close the terminal only when an open shell is what blocks the source', () => {
    const terminal = { code: 'terminal' as const, message: 'Its Terminal tab has a shell open.' };
    expect(closesTerminal(terminal)).toBe(true);
    expect(closesTerminal({ code: 'running', message: 'A turn is running in it.' })).toBe(false);
    expect(closesTerminal(null)).toBe(false);
    const note = (block: typeof terminal | { code: 'running'; message: string }) =>
      renderToStaticMarkup(createElement(BlockNote, { block, onRecheck: () => {}, onCloseTerminal: () => {}, closing: false }));
    expect(note(terminal)).toContain('Close terminal');
    expect(note({ code: 'running', message: 'A turn is running in it.' })).not.toContain('Close terminal');
  });

  it('says a message that starts with a slash command takes the carryover to the next one', () => {
    expect(slashHint('/review the diff')).toMatch(/^A slash command runs first/);
    expect(slashHint('  /compact')).not.toBeNull();
    expect(slashHint('Carry on with /tmp cleanup')).toBeNull();
    expect(slashHint('')).toBeNull();
  });

  it('keeps the request id after a failed Start so the retry reuses it, and drops one the server says was reused', () => {
    const attempt = { key: 'k', id: 'id-1' };
    const failed = continueReducer(continueReducer(ready(), { type: 'posting', attempt }), { type: 'refused', error: { kind: 'error', error: 'Cannot reach the Omni server. Is it running?' } });
    expect(failed).toMatchObject({ posting: false, attempt });
    expect(refusalText(failed.refusal)).toBe('Cannot reach the Omni server. Is it running?');
    const reused = continueReducer(continueReducer(ready(), { type: 'posting', attempt }), { type: 'refused', error: { kind: 'reused', error: 'Used already.' } });
    expect(reused.attempt).toBeNull();
  });
});

describe("the preview's sections", () => {
  it('lists each section that has something, in reading order', () => {
    expect(previewSections(carryover()).map((s) => s.title)).toEqual(['Goal', 'Constraints']);
    const full = carryover({
      files: { base: 'b', head: 'h', tree: 't', listed: [{ path: 'a.ts', old_path: null, status: 'modified' }], total: 1 },
      checks: [{ id: 4, command: 'npm test', ok: true, output: 'ok' }],
      recent: [{ id: 9, who: 'agent', text: 'Done.', condensed: false }],
      omitted: [{ what: 'history', count: 3, note: '3 older entries', ref: '/api/threads/src/history?through=5' }],
    });
    expect(previewSections(full).map((s) => s.title)).toEqual(['Goal', 'Constraints', 'Changed files', 'Checks', 'Recent history', 'Left out']);
  });

  it('says how many changed files the Carryover does not list', () => {
    const listed = [
      { path: 'src/a.ts', old_path: null, status: 'added' as const },
      { path: 'src/b.ts', old_path: 'src/old-b.ts', status: 'renamed' as const },
    ];
    const files = previewSections(carryover({ files: { base: null, head: 'h', tree: 't', listed, total: 14 } })).find((s) => s.id === 'files')!;
    expect(files).toMatchObject({ count: 14, more: '12 more' });
    expect(files.rows).toEqual([
      expect.objectContaining({ text: 'src/a.ts', code: true, tag: 'added' }),
      expect.objectContaining({ text: 'src/b.ts', tag: 'renamed', sub: 'from src/old-b.ts' }),
    ]);
    const all = previewSections(carryover({ files: { base: null, head: 'h', tree: 't', listed, total: 2 } })).find((s) => s.id === 'files')!;
    expect(all.more).toBeNull();
  });

  it('marks checks passed or failed, with the end of their output', () => {
    const checks = previewSections(
      carryover({
        checks: [
          { id: 1, command: 'npm run typecheck', ok: true, output: '' },
          { id: 2, command: 'npm test', ok: false, output: 'FAIL sync.test.ts\n' },
        ],
      }),
    ).find((s) => s.id === 'checks')!;
    expect(checks.rows).toEqual([
      expect.objectContaining({ text: 'npm run typecheck', tag: 'Passed', tone: 'pass', sub: undefined }),
      expect.objectContaining({ text: 'npm test', tag: 'Failed', tone: 'fail', sub: 'FAIL sync.test.ts' }),
    ]);
  });

  it('marks history entries that were shortened to fit, under who wrote them', () => {
    const recent = previewSections(
      carryover({
        recent: [
          { id: 3, who: 'user', text: 'Fix the flaky test', condensed: true },
          { id: 8, who: 'agent', text: 'The race is in the retry loop.\nFixed it.', condensed: false },
        ],
      }),
    ).find((s) => s.id === 'recent')!;
    expect(recent.rows.map((r) => [r.label, r.tag])).toEqual([
      ['You', 'Shortened'],
      ['Agent', undefined],
    ]);
  });

  it('gives each left-out part its note and where to read it', () => {
    const sections = previewSections(
      carryover({
        omitted: [
          { what: 'history', count: 20, note: '20 older entries', ref: '/api/threads/src/history?through=41' },
          { what: 'untracked', count: 2, note: '2 untracked binary files', ref: null },
        ],
      }),
    );
    expect(sections.find((s) => s.id === 'omitted')!.rows).toEqual([
      expect.objectContaining({ text: '20 older entries', sub: '/api/threads/src/history?through=41' }),
      expect.objectContaining({ text: '2 untracked binary files', sub: undefined }),
    ]);
  });

  it('reads its size against the budget, and where the new thread works', () => {
    expect(sizeLine({ chars: 12_300, budget: 24_000 })).toBe('12.3k of 24k characters');
    expect(sizeLine({ chars: 850, budget: 24_000 })).toBe('850 of 24k characters');
    expect(sizeLine({ chars: 24_000, budget: 24_000 })).toBe('24k of 24k characters');
    expect(workspaceText({ workspace: 'worktree' })).toMatch(/new branch and worktree/);
    expect(workspaceText({ workspace: 'folder' })).toMatch(/channel's folder/);
  });
});

describe('the links between the two threads', () => {
  const link = (id: string, created_at: string, over: Partial<ContinueLink> = {}): ContinueLink => ({
    id,
    title: id,
    harness: 'codex',
    model: null,
    status: 'done',
    created_at,
    carried: null,
    ...over,
  });
  const row = (over: Partial<Thread>) => ({ id: 'new', title: 'Continue the fix', harness: 'codex', model: null, status: 'running', created_at: '2026-10-24T10:00:00Z', continued_from: 'src', ...over }) as Thread;
  const carried = { entries: 34, condensed: 12, omitted: 20, chars: 12_300, budget: 24_000, files: 3 };

  it('adds a thread the feed says continues this one, and keeps it current with what it carried', () => {
    const added = linksWith(NO_LINKS, 'src', row({}));
    expect(added.into).toEqual([link('new', '2026-10-24T10:00:00Z', { title: 'Continue the fix', status: 'running' })]);
    const known = { from: null, into: [link('new', '2026-10-24T10:00:00Z', { carried })] };
    expect(linksWith(known, 'src', row({ status: 'done', title: 'Fixed' })).into).toEqual([link('new', '2026-10-24T10:00:00Z', { title: 'Fixed', status: 'done', carried })]);
  });

  it('keeps the thread this one continues current', () => {
    const links = { from: link('src', '2026-10-23T09:00:00Z', { carried }), into: [] };
    const next = linksWith(links, 'new', row({ id: 'src', title: 'Fix the flaky test', continued_from: null, status: 'done' }));
    expect(next.from).toMatchObject({ id: 'src', title: 'Fix the flaky test', status: 'done', carried });
  });

  it('leaves the links alone for any other thread', () => {
    const links = { from: link('src', '2026-10-23T09:00:00Z'), into: [] };
    expect(linksWith(links, 'new', row({ id: 'other', continued_from: 'elsewhere' }))).toBe(links);
  });

  it('picks the newest continuation for the header', () => {
    expect(newestLink([])).toBeNull();
    expect(newestLink([link('a', '2026-10-24T10:00:00Z'), link('b', '2026-10-24T12:00:00Z'), link('c', '2026-10-24T11:00:00Z')])?.id).toBe('b');
  });

  it('shows the desktop header where the thread came from, with what it carried, and the newest that carries it on', () => {
    const html = renderToStaticMarkup(
      createElement(ContinueCrumbs, {
        links: { from: link('src', '2026-10-23T09:00:00Z', { title: 'Fix the flaky test', harness: 'claude-code', carried }), into: [link('a', '2026-10-24T10:00:00Z'), link('b', '2026-10-24T12:00:00Z', { title: 'Add the test' })] },
      }),
    );
    expect(html).toContain('Continued from Fix the flaky test · Claude Code');
    expect(html).toContain('title="Carried 34 entries (12 shortened), 20 older left out, 3 changed files."');
    expect(html).toContain('Continued in Add the test · Codex +1');
    expect(html).toContain('href="#/t/src"');
    expect(renderToStaticMarkup(createElement(ContinueCrumbs, { links: NO_LINKS }))).toBe('');
  });

  it('lists both directions above a phone thread, each a button that opens that thread', () => {
    const opened: string[] = [];
    const links = { from: link('src', '2026-10-23T09:00:00Z', { title: 'Fix the flaky test', harness: 'claude-code', carried }), into: [link('b', '2026-10-24T12:00:00Z', { title: 'Add the test' })] };
    const html = renderToStaticMarkup(createElement(MoContinueLinks, { links, onOpen: (id: string) => opened.push(id) }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('Continued from</span> Fix the flaky test');
    expect(html).toContain('Claude Code · Carried 34 entries');
    expect(html).toContain('Continued in</span> Add the test');
    expect(html).not.toContain('href=');
    expect(renderToStaticMarkup(createElement(MoContinueLinks, { links: NO_LINKS, onOpen: () => {} }))).toBe('');
  });
});

describe("a continued thread's carryover event", () => {
  // The server writes a `carryover` event in the continued thread (it fills ContinueLink.carried); no client draws it.
  const ev = (id: number, kind: string, payload: unknown): TranscriptEvent => ({ id, kind, payload: JSON.stringify(payload), created_at: `2026-10-24T10:0${id}:00.000Z` });
  const events = [
    ev(1, 'carryover', { entries: 34, condensed: 12, omitted: 20, chars: 12_300, budget: 24_000, files: 3 }),
    ev(2, 'user', { text: 'Carry on' }),
    ev(3, 'assistant_text', { text: 'On it.' }),
    ev(4, 'result', { ok: true, subtype: 'success', duration_ms: 1000, turns: 1 }),
  ];

  it('folds to nothing in the desktop transcript', () => {
    expect(buildItems(events).items.map((it) => it.type)).toEqual(['user', 'text', 'result']);
  });

  it('leaves the phone thread one turn, opened by Ben\'s message', () => {
    const v = threadView({ events, thread: { status: 'done', cwd: '/w', harness: 'codex' }, artifacts: [], children: [] });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0]!.prompts.map((p) => p.text)).toEqual(['Carry on']);
  });
});
