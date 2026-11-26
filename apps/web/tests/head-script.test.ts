// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLayout, readListCollapsed } from '../src/layout-pref.ts';
import { parseHash } from '../src/router.ts';
import { DESKTOP_QUERY, readPref } from '../src/store.tsx';

// index.html's inline script decides the theme and the desktop layout before the first paint, in plain ES5 that
// cannot import the modules React uses afterwards. These run it against those modules, so the first frame and
// App.tsx's first render never disagree (a flip would swap the rail's faces after paint, audit L10).

const html = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

type Run = { layout?: string; list?: string; theme?: string; scheme: string; preloads: { rel: string; as: string; type: string; crossOrigin: string; href: string }[]; queries: string[] };

/** Runs the head script on a stand-in document: `wide` answers the desktop query, the stored prefs are real. */
function runHead({ wide, hash = '#/', fonts = '/assets/a-500.woff2 /assets/a-600.woff2' }: { wide: boolean; hash?: string; fonts?: string }): Run {
  const dataset: Record<string, string> = {};
  const metas: Record<string, { content: string }> = { 'color-scheme': { content: 'light dark' }, 'omni-rail-fonts': { content: fonts } };
  const preloads: Run['preloads'] = [];
  const queries: string[] = [];
  const document = {
    documentElement: { dataset },
    querySelector: (sel: string) => metas[sel.match(/^meta\[name="([^"]+)"\]$/)?.[1] ?? ''] ?? null,
    createElement: () => ({ rel: '', as: '', type: '', crossOrigin: '', href: '' }),
    head: { appendChild: (el: Run['preloads'][number]) => preloads.push(el) },
  };
  const matchMedia = (q: string) => (queries.push(q), { matches: wide && q === DESKTOP_QUERY });
  runInNewContext(inline[0], { document, matchMedia, localStorage, location: { hash } });
  return { layout: dataset.layout, list: dataset.list, theme: dataset.theme, scheme: metas['color-scheme'].content, preloads, queries };
}

/** What App.tsx renders with: the Shell's data-layout, which the phone layout and the Quick Prompt panel skip. */
const appLayout = (wide: boolean, hash: string) => (wide && parseHash(hash).name !== 'quick-prompt' ? readLayout() : undefined);

const store = (key: string, raw: string | null) => (raw == null ? localStorage.removeItem(`omni.${key}`) : localStorage.setItem(`omni.${key}`, raw));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("index.html's head script", () => {
  it('is the one inline script, so the CSP hashes just it', () => {
    expect(inline).toHaveLength(1);
  });

  it('asks the breakpoint the app asks', () => {
    expect(runHead({ wide: true }).queries).toEqual([DESKTOP_QUERY]);
  });

  const layouts = [null, '"rail"', '"classic"', '"sideways"', 'not json'];
  const hashes = ['#/', '#/settings/general', '#/t/abc', '#/quick-prompt', '#quick-prompt', '#/quick-prompt?x=1'];
  for (const raw of layouts)
    for (const wide of [true, false])
      for (const hash of hashes)
        it(`sets the layout App.tsx draws: layout ${raw}, ${wide ? 'desktop' : 'phone'} width, ${hash}`, () => {
          store('layout', raw);
          expect(runHead({ wide, hash }).layout).toBe(appLayout(wide, hash));
        });

  for (const raw of [null, 'true', 'false', '"true"', 'not json'])
    it(`sets data-list when the list panel is collapsed, as readListCollapsed says: ${raw}`, () => {
      store('rail.listCollapsed', raw);
      expect(runHead({ wide: true }).list).toBe(readListCollapsed() ? 'collapsed' : undefined);
    });

  it('preloads the rail faces only when it draws the rail, and only with built paths', () => {
    const preload = (href: string) => ({ rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous', href });
    expect(runHead({ wide: true }).preloads).toEqual([preload('/assets/a-500.woff2'), preload('/assets/a-600.woff2')]);
    expect(runHead({ wide: false }).preloads).toEqual([]);
    expect(runHead({ wide: true, hash: '#/quick-prompt' }).preloads).toEqual([]);
    expect(runHead({ wide: true, fonts: '' }).preloads).toEqual([]);
    store('layout', '"classic"');
    expect(runHead({ wide: true }).preloads).toEqual([]);
  });

  for (const [raw, forced] of [[null, null], ['"system"', null], ['"light"', 'light'], ['"dark"', 'dark'], ['"sepia"', null], ['{', null]] as const)
    it(`forces the theme theme.tsx would: ${raw}`, () => {
      store('theme', raw);
      const run = runHead({ wide: true });
      const pref = readPref<unknown>('theme', 'system');
      expect(forced).toBe(pref === 'light' || pref === 'dark' ? pref : null);
      expect(run.theme).toBe(forced ?? undefined);
      expect(run.scheme).toBe(forced ?? 'light dark');
    });

  it('falls back like readPref when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const run = runHead({ wide: true });
    expect(run.layout).toBe(readLayout());
    expect(run.theme).toBeUndefined();
    expect(run.scheme).toBe('light dark');
  });
});
