import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MARK, PHASE, type Mark, type Phase } from '@omni/shared/status.ts';
import { Loader, StatusDot, ThreadDot } from '../src/components/ui/status.tsx';
import { threadPill } from '../src/components/thread/thread-state.ts';
import { rowOf } from '../src/mobile/rows.ts';

// One running signal: the status dot, in the thread's phase. No spinner and no moving Omni mark says that something
// runs, anywhere in the Web UI.
const SRC = join(import.meta.dirname, '../src');
const dot = (props: Parameters<typeof StatusDot>[0]) => renderToStaticMarkup(createElement(StatusDot, props));
const mark = (props: Parameters<typeof ThreadDot>[0]) => renderToStaticMarkup(createElement(ThreadDot, props));

describe('the status dot', () => {
  it('draws each phase as the running dot, named for its tooltip and for a screen reader', () => {
    for (const phase of Object.keys(PHASE) as Phase[]) {
      const html = dot({ status: 'running', phase });
      expect(html).toContain(`data-s="running" data-mark="${phase}"`);
      expect(html).toContain(`data-phase="${phase}"`);
      expect(html).toContain(`aria-label="${PHASE[phase].label}"`);
      expect(html).toContain(`title="${PHASE[phase].label}. `);
      // A halo while its own turn works, a breath while it waits on other work: never both.
      expect(html.includes('class="ping"')).toBe(MARK[phase].motion === 'ping');
      expect(html.includes('class="breathe"')).toBe(MARK[phase].motion === 'breathe');
    }
  });

  it('draws every state as a shape of its own, named and still unless it is at work', () => {
    const shapes = new Map<string, Mark>();
    for (const m of Object.keys(MARK) as Mark[]) {
      const html = dot({ mark: m });
      expect(html).toContain(`data-mark="${m}" data-family="${MARK[m].family}"`);
      expect(html).toContain(`aria-label="${MARK[m].label}"`);
      expect(html).toContain(`title="${MARK[m].label}. `);
      if (MARK[m].motion === 'still') expect(html).not.toMatch(/class="(ping|breathe)"/);
      // No two states share a drawing, so none leans on color or motion alone.
      const shape = html.slice(html.indexOf('<svg')).replace(' class="breathe"', '');
      expect(shapes.get(shape)).toBeUndefined();
      shapes.set(shape, m);
    }
    expect(new Set(Object.values(MARK).map((k) => k.label)).size).toBe(Object.keys(MARK).length);
  });

  it('keeps the plain name on a bare status, which also marks things that are not threads', () => {
    expect(dot({ status: 'done' })).toContain('title="Done"');
    expect(dot({ status: 'needs' })).toContain('title="Needs you"');
  });

  it('is the plain running dot without a phase', () => {
    const html = dot({ status: 'running' });
    expect(html).toContain('title="Running"');
    expect(html).toContain('data-mark="working"');
  });

  it('shows Starting on a thread still queued while its folder is prepared', () => {
    expect(dot({ status: 'queued', phase: 'starting' })).toContain('data-s="running" data-mark="starting"');
  });

  it('keeps a phase off a thread that is not at work', () => {
    for (const status of ['needs', 'failed', 'limited', 'done', 'settled', 'idle']) expect(dot({ status, phase: 'working' })).not.toContain('data-phase');
  });
});

describe("a thread row's mark", () => {
  it('draws the phase while the thread is at work', () => {
    expect(mark({ t: { status: 'running' } })).toContain('data-phase="working"');
    expect(mark({ t: { status: 'queued', setup: 'preparing' } })).toContain('data-phase="starting"');
    expect(mark({ t: { status: 'done', delegating: true } })).toContain('data-phase="delegating"');
    // Sub-agents a stopped turn left behind: the row knows of them, the thread's own state does not.
    expect(mark({ t: { status: 'stopped' }, busy: true })).toContain('data-phase="delegating"');
  });

  it('gives way to needs you and failed, which the thread tree puts first', () => {
    expect(mark({ t: { status: 'running' }, state: 'needs' })).toContain('data-s="needs"');
    expect(mark({ t: { status: 'running' }, state: 'failed' })).toContain('data-s="failed"');
  });

  it('is the check once marked done, else the status', () => {
    expect(mark({ t: { status: 'done', done_at: '2026-11-16T10:00:00Z' } })).toContain('title="Marked done"');
    expect(mark({ t: { status: 'queued' } })).toContain('data-s="queued"');
    expect(mark({ t: { status: 'failed', limit_state: 'limited' } })).toContain('data-s="limited"');
  });

  it('says how it ended beyond the status: a folder that never got ready, a pull request to review', () => {
    expect(mark({ t: { status: 'failed', setup: 'failed' } })).toContain('data-mark="setup_failed"');
    expect(mark({ t: { status: 'done' }, pr: { state: 'OPEN', isDraft: false } })).toContain('data-mark="review"');
    expect(mark({ t: { status: 'done' }, pr: { state: 'OPEN', isDraft: true } })).toContain('data-mark="done"');
    expect(mark({ t: { status: 'done' }, pr: { state: 'MERGED', isDraft: false } })).toContain('data-mark="done"');
    expect(mark({ t: { status: 'running' }, pr: { state: 'OPEN', isDraft: false } })).toContain('data-mark="working"');
  });
});

describe('loading', () => {
  it('is the same dot in the text color, not a spinner', () => {
    const html = renderToStaticMarkup(createElement(Loader, { size: 12 }));
    expect(html).toContain('role="status" aria-label="Loading" data-s="running" data-mark="loading"');
    expect(html).toContain('class="ping"');
  });
});

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe('the phase a thread shows by name', () => {
  const t = { id: 't', channel_id: 'c', title: 'T', created_at: '2026-01-01T00:00:00.000Z', limit_state: null, limit_resets_at: null };

  it('names the phase on the thread header pill', () => {
    expect(threadPill({ ...t, status: 'running' }, { turn: 'tool' })).toEqual({ glyph: 'running', label: 'Running a tool', phase: 'tool', mark: 'tool' });
    expect(threadPill({ ...t, status: 'done', delegating: true })).toEqual({ glyph: 'running', label: 'Waiting on crew', phase: 'delegating', mark: 'delegating' });
    expect(threadPill({ ...t, status: 'queued', setup: 'preparing' })).toMatchObject({ label: 'Starting', phase: 'starting' });
    expect(threadPill({ ...t, status: 'queued' })).toEqual({ glyph: 'queued', label: 'Queued', mark: 'queued' });
  });

  it('names what holds the thread up, and a review, on the pill', () => {
    expect(threadPill({ ...t, status: 'running' }, { need: { blockers: [{ kind: 'question', from: ['kid'] }] } })).toEqual({ glyph: 'needs', label: 'Crew waits on you', mark: 'crew_question' });
    expect(threadPill({ ...t, status: 'done' }, { need: { blockers: [{ kind: 'recovered' }] } })).toMatchObject({ label: 'Message held', mark: 'held' });
    expect(threadPill({ ...t, status: 'done' }, { pr: { state: 'OPEN', isDraft: false } })).toEqual({ glyph: 'done', label: 'Ready for review', mark: 'review' });
    expect(threadPill({ ...t, status: 'failed', setup: 'failed' })).toMatchObject({ glyph: 'failed', label: 'Setup failed', mark: 'setup_failed' });
  });

  it('names it on a phone list row', () => {
    expect(rowOf({ ...t, status: 'done', delegating: true }, undefined, 0)).toMatchObject({ status: 'running', phase: 'delegating', meta: 'Waiting on crew' });
    expect(rowOf({ ...t, status: 'running' }, undefined, 0)).toMatchObject({ status: 'running', phase: 'working', meta: 'Running' });
    expect(rowOf({ ...t, status: 'done' }, undefined, 0).phase).toBeUndefined();
  });

  it('says who a thread is for when that is someone else', () => {
    expect(rowOf({ ...t, status: 'done', owner: 'Sam' }, undefined, 0, 'Ada').meta).toBe('for Sam');
    expect(rowOf({ ...t, status: 'running', owner: 'Sam' }, undefined, 0, 'Ada').meta).toBe('Running · for Sam');
    expect(rowOf({ ...t, status: 'done', owner: 'ada' }, undefined, 0, 'Ada').meta).toBeNull();
  });
});

/** What a spinner or a working Omni mark looks like in the source. */
const SPINNERS: [string, RegExp][] = [
  ['a rotating SVG', /animateTransform/],
  ['a spin class or keyframe', /omni-spin|animate-spin|(?<![\w-])spin(?![\w-])/],
  ['an Omni mark in a working state', /<OmniMark\b[^>]*\bstate=\{?['"`]?[^>]*(thinking|delegating|report)/],
];

describe('no spinner says that something runs', () => {
  it('finds none in the Web UI source', () => {
    const found = files(SRC).flatMap((path) => {
      const src = readFileSync(path, 'utf8');
      return SPINNERS.filter(([, re]) => re.test(src)).map(([what]) => `${relative(SRC, path)}: ${what}`);
    });
    expect(found).toEqual([]);
  });

  it('moves a mark in two ways only, and not at all under reduced motion', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    // The mark rules set color only: the halo and the breath are the two animations, each one class.
    const marks = css.slice(css.indexOf('/* ---- status marks'), css.indexOf('/* Status pill'));
    expect(marks).not.toMatch(/animation|transition|@keyframes/);
    expect(css).toMatch(/\n\.ping \{\s*animation: omni-ping var\(--dur-ping\)/);
    expect(css).toMatch(/\n\.breathe \{\s*animation: omni-breathe /);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ping,\s*\.breathe[^{]*\{\s*animation: none !important/);
    // Still, the halo is not drawn at all: no disc sits behind a hollow mark.
    expect(marks).toMatch(/\.glyph > \.ping \{[^}]*opacity: 0;/);
  });
});
