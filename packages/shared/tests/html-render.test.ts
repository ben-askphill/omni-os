import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { INLINE_MAX_HEIGHT, isRenderPath, readFrameHeight, RENDER_COLORS, RENDER_MAX_BYTES, RENDER_MAX_TITLE, RENDER_OTHER, renderedFrom, renderedText, RENDER_NARROW_CSS, withFrameScript, withNarrowSheet } from '../html-render.ts';

const cases = JSON.parse(readFileSync(fixture('html-render.json'), 'utf8')) as {
  case: string;
  name: string;
  input: unknown;
  result: { text: string; is_error: boolean };
  expected: unknown;
}[];

describe('renderedFrom', () => {
  it.each(cases.map((c) => [c.case, c] as const))('%s', (_, c) => {
    expect(renderedFrom(c.name, c.input, c.result)).toEqual(c.expected);
  });

  it('reads back what html_render answers', () => {
    const r = { artifact: 12, title: 'Signups "by week"' };
    expect(renderedFrom('mcp__omni-render__html_render', { title: r.title }, { text: renderedText(r), is_error: false })).toEqual(r);
  });

  it('needs a result', () => {
    expect(renderedFrom('mcp__omni-render__html_render', { title: 'T' }, undefined)).toBeNull();
  });
});

describe('isRenderPath', () => {
  it('takes pages under artifacts/renders only', () => {
    expect(isRenderPath('/d/threads/t1/artifacts/renders/commits-a1b2.html')).toBe(true);
    expect(isRenderPath('/d/threads/t1/artifacts/report.html')).toBe(false);
    expect(isRenderPath('/d/threads/t1/artifacts/renders/data.csv')).toBe(false);
    expect(isRenderPath('/d/threads/t1/artifacts/renders/deep/x.html')).toBe(false);
  });
});

describe('withFrameScript', () => {
  const where = (html: string) => withFrameScript(html).indexOf('<script>(function(');

  it('goes first in the head', () => {
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>hi</body></html>';
    expect(where(html)).toBe(html.indexOf('<meta'));
  });

  it('skips a head tag inside a comment', () => {
    const html = '<!doctype html><!-- <head> --><html><head data-x="1"><title>t</title></head></html>';
    expect(where(html)).toBe(html.indexOf('<title>'));
  });

  it('goes after the html tag or the doctype when there is no head', () => {
    expect(where('<html><body>x</body></html>')).toBe('<html>'.length);
    expect(where('<!DOCTYPE html>\n<p>x</p>')).toBe('<!DOCTYPE html>'.length);
  });

  it('goes first in a fragment and keeps the page intact', () => {
    const html = '<p>just a fragment</p>';
    expect(where(html)).toBe(0);
    expect(withFrameScript(html).replace(/<style id="omni-narrow">[^<]*<\/style>/, '').endsWith(html)).toBe(true);
  });

  it('adds the narrow sheet once, after the page\'s head styles', () => {
    const html = '<!doctype html><html><head><style>td{overflow-wrap:anywhere}</style></head><body><table></table></body></html>';
    const out = withFrameScript(html);
    expect(out.match(/id="omni-narrow"/g)).toHaveLength(1);
    expect(out.indexOf('omni-narrow')).toBeGreaterThan(out.indexOf('anywhere'));
    expect(out.indexOf('omni-narrow')).toBeLessThan(out.indexOf('</head>'));
  });
});

describe('withNarrowSheet', () => {
  const sheet = `<style id="omni-narrow">${RENDER_NARROW_CSS}</style>`;

  it('goes at the end of the head, skipping one in a comment', () => {
    expect(withNarrowSheet('<head><style>a{}</style></head><body>x</body>')).toBe(`<head><style>a{}</style>${sheet}</head><body>x</body>`);
    expect(withNarrowSheet('<!-- </head> --><head></HEAD >')).toBe(`<!-- </head> --><head>${sheet}</HEAD >`);
  });

  it('goes at the end of a page with no head, after its own styles', () => {
    expect(withNarrowSheet('<style>td{}</style><table></table>')).toBe(`<style>td{}</style><table></table>${sheet}`);
  });

  // Desktop frames (about 680px) never match, so pages look there as they did before.
  it('only applies to a narrow frame, and keeps table cells breaking between words', () => {
    expect(RENDER_NARROW_CSS.startsWith('@media (max-width:480px){')).toBe(true);
    expect(RENDER_NARROW_CSS).toContain('table{display:block;max-width:100%;overflow-x:auto}');
    expect(RENDER_NARROW_CSS).toMatch(/th,td\{overflow-wrap:break-word;word-break:normal/);
  });
});

describe('readFrameHeight', () => {
  it('takes the height message and clamps it', () => {
    expect(readFrameHeight({ type: 'omni:render-height', height: 412.2 })).toBe(413);
    expect(readFrameHeight({ type: 'omni:render-height', height: 1e9 })).toBe(INLINE_MAX_HEIGHT);
  });

  it('ignores anything else a page posts', () => {
    for (const d of [null, 'omni:render-height', { type: 'other', height: 10 }, { type: 'omni:render-height', height: -5 }, { type: 'omni:render-height', height: Infinity }, { type: 'omni:render-height', height: '300' }]) {
      expect(readFrameHeight(d)).toBeUndefined();
    }
  });
});

// The tool itself is Rust (crates/omni-mcp/src/render.rs). Its limits and the theme variables its description names
// are copies of the ones here, which the server and the frame use.
describe('the html_render tool in crates/omni-mcp', () => {
  const rust = readFileSync(join(import.meta.dirname, '../../../crates/omni-mcp/src/render.rs'), 'utf8');
  const constant = (name: string) => Number(new RegExp(`const ${name}: u32 = ([\\d_]+);`).exec(rust)?.[1].replaceAll('_', ''));

  it('has the same limits', () => {
    expect([constant('MAX_TITLE'), constant('MAX_HTML')]).toEqual([RENDER_MAX_TITLE, RENDER_MAX_BYTES]);
  });

  it('names every theme variable the frame sets, in order', () => {
    // A backslash at a line's end continues a Rust string past the newline and the next line's indent.
    const guide = (/const GUIDE: &str = "([^"]*)"/.exec(rust)?.[1] ?? '').replace(/\\\n\s*/g, '');
    expect(guide).toContain([...Object.keys(RENDER_COLORS), ...Object.keys(RENDER_OTHER)].join(', '));
  });

  it('asks every page for a very narrow breakpoint', () => {
    const guide = (/const GUIDE: &str = "([^"]*)"/.exec(rust)?.[1] ?? '').replace(/\\\n\s*/g, '');
    expect(guide).toContain('Every page needs a breakpoint rule for very narrow frames, @media (max-width: 360px)');
  });
});
