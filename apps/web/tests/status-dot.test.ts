import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PHASE, type Phase } from '@omni/shared/status.ts';
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
      expect(html).toContain(`data-s="running" data-phase="${phase}"`);
      expect(html).toContain(`aria-label="${PHASE[phase].label}"`);
      expect(html).toContain(`title="${PHASE[phase].label}. `);
      expect(html).toContain('class="ping"');
    }
  });

  it('is the plain running dot without a phase', () => {
    const html = dot({ status: 'running' });
    expect(html).toContain('title="Running"');
    expect(html).not.toContain('data-phase');
  });

  it('shows Starting on a thread still queued while its folder is prepared', () => {
    expect(dot({ status: 'queued', phase: 'starting' })).toContain('data-s="running" data-phase="starting"');
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
});

describe('loading', () => {
  it('is the same dot in the text color, not a spinner', () => {
    const html = renderToStaticMarkup(createElement(Loader, { size: 12 }));
    expect(html).toContain('role="status" aria-label="Loading" data-s="running" data-phase="loading"');
    expect(html).not.toContain('<svg');
  });
});

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe('the phase a thread shows by name', () => {
  const t = { id: 't', channel_id: 'c', title: 'T', created_at: '2026-01-01T00:00:00.000Z', limit_state: null, limit_resets_at: null };

  it('names the phase on the thread header pill', () => {
    expect(threadPill({ ...t, status: 'running' }, { turn: 'tool' })).toEqual({ glyph: 'running', label: 'Running a tool', phase: 'tool' });
    expect(threadPill({ ...t, status: 'done', delegating: true })).toEqual({ glyph: 'running', label: 'Waiting on crew', phase: 'delegating' });
    expect(threadPill({ ...t, status: 'queued', setup: 'preparing' })).toMatchObject({ label: 'Starting', phase: 'starting' });
    expect(threadPill({ ...t, status: 'queued' })).toEqual({ glyph: 'queued', label: 'Queued' });
  });

  it('names it on a phone list row', () => {
    expect(rowOf({ ...t, status: 'done', delegating: true }, undefined, 0)).toMatchObject({ status: 'running', phase: 'delegating', meta: 'Waiting on crew' });
    expect(rowOf({ ...t, status: 'running' }, undefined, 0)).toMatchObject({ status: 'running', phase: 'working', meta: 'Running' });
    expect(rowOf({ ...t, status: 'done' }, undefined, 0).phase).toBeUndefined();
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

  it('moves every running dot with the one halo, and not at all under reduced motion', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    // The phase rules draw shapes and colors only: the halo is the one .ping animation, slower for the waiting phases.
    const phases = css.slice(css.indexOf('/* Running, by phase'), css.indexOf('.glyph[data-s="needs"]'));
    expect(phases).not.toMatch(/animation|transition|@keyframes/);
    expect(css).toMatch(/\n\.ping \{\s*animation: omni-ping var\(--dur-ping\)/);
    expect(css).toMatch(/\[data-phase="delegating"\][^{]*> \.ping \{\s*animation-duration: calc\(var\(--dur-ping\) \* 1\.5\)/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ping[^{]*\{\s*animation: none !important/);
  });
});
