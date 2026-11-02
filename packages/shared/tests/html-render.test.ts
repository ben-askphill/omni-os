import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { INLINE_MAX_HEIGHT, isRenderPath, readFrameHeight, renderedFrom, renderedText, withFrameScript } from '../html-render.ts';

// The same cases run in apps/mac/OmniKit/Tests/OmniKitTests/HtmlRenderTests.swift.
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
    expect(withFrameScript(html).endsWith(html)).toBe(true);
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
