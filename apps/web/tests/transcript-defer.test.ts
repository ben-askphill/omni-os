import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EventRow } from '../src/api.ts';
import { defers, LIVE_ROWS, LIVE_TURNS } from '../src/transcript/defer.ts';

// Long threads hold up to 6,000 rows. Older rows skip rendering while out of view (`.tx-row`, content-visibility),
// the newest never do, so the live turn and the bottom pin never meet a placeholder.

vi.mock('../src/store.tsx', async (original) => ({ ...(await original<object>()), useApp: () => ({ tasks: [], feedLive: true, needsYou: [], channel: () => undefined }), useNeedOf: () => null }));

const { Transcript } = await import('../src/components/Transcript.tsx');

let id = 0;
const ev = (kind: string, payload: unknown): EventRow => ({ id: ++id, thread_id: 't1', kind, payload: JSON.stringify(payload), created_at: '2026-11-19T10:00:00.000Z' }) as EventRow;
const shot = { name: 'shot.png', path: 'uploads/shot.png', size: 2048, image: true };
/** `turns` turns of a message with a screenshot, a reply and a result: three rows each. */
const thread = (turns: number) =>
  Array.from({ length: turns }, (_, t) => [
    ev('user', { text: `Turn ${t}`, source: 'ben', attachments: [shot] }),
    ev('assistant_text', { text: `Reply ${t}` }),
    ev('result', { ok: true, subtype: 'success', turns: 1 }),
  ]).flat();
const rows = (html: string) => [...html.matchAll(/<div data-key="(\d+)" class="([^"]*)"/g)].map((m) => ({ key: Number(m[1]), cls: m[2].split(' ') }));

describe('defers', () => {
  it('never defers the newest rows', () => {
    expect([0, 1, 2, 3, 4].map((i) => defers(i, 5, 2))).toEqual([true, true, true, false, false]);
    expect([0, 1].map((i) => defers(i, 2, LIVE_TURNS))).toEqual([false, false]);
  });
});

describe('Transcript rows', () => {
  it('marks every row but the newest LIVE_ROWS as .tx-row', () => {
    const html = renderToStaticMarkup(createElement(Transcript, { threadId: 't1', events: thread(10), running: false }));
    const all = rows(html);
    expect(all).toHaveLength(30);
    const deferred = all.filter((r) => r.cls.includes('tx-row'));
    expect(deferred).toHaveLength(30 - LIVE_ROWS);
    expect(all.slice(-LIVE_ROWS).every((r) => !r.cls.includes('tx-row'))).toBe(true);
    expect(all.slice(0, -LIVE_ROWS).every((r) => r.cls.includes('tx-row'))).toBe(true);
  });

  it('defers nothing in a short thread', () => {
    const html = renderToStaticMarkup(createElement(Transcript, { threadId: 't1', events: thread(3), running: true }));
    expect(rows(html).some((r) => r.cls.includes('tx-row'))).toBe(false);
  });

  it('loads the newest rows images at once and older ones lazily, each in a fixed-height box', () => {
    const html = renderToStaticMarkup(createElement(Transcript, { threadId: 't1', events: thread(10), running: false }));
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(10);
    // Rows 0..17 defer: turns 0-5 hold their user row there. Turns 6-9 are in the newest twelve.
    expect(imgs.slice(0, 6).every((i) => i.includes('loading="lazy"'))).toBe(true);
    expect(imgs.slice(6).every((i) => !i.includes('loading='))).toBe(true);
    expect(imgs.every((i) => /\bh-44\b/.test(i))).toBe(true);
  });
});

describe('the .tx-row rules', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const rule = (sel: string) => css.match(new RegExp(`\\n\\s*${sel.replace(/[.()]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

  it('skips rendering with an estimated height, and keeps the last real one', () => {
    expect(rule('.tx-row')).toMatch(/content-visibility: auto/);
    expect(rule('.tx-row')).toMatch(/contain-intrinsic-size: auto none auto \S+/);
    expect(rule('.tx-turn')).toMatch(/contain-intrinsic-size: auto none auto \S+/);
  });
});
