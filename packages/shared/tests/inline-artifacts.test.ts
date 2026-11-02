import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { INLINE_MAX_HEIGHT, inlineArtifactsByGroup, readFrameHeight, withFrameScript, type InlineCandidate, type InlineGroup } from '../inline-artifacts.ts';

// The same cases run in apps/mac/OmniKit/Tests/OmniKitTests/InlineArtifactsTests.swift.
const cases = JSON.parse(readFileSync(fixture('inline-artifacts.json'), 'utf8')) as {
  case: string;
  groups: InlineGroup[];
  artifacts: (InlineCandidate & { id: number })[];
  expected: Record<string, number[]>;
}[];

describe('inlineArtifactsByGroup', () => {
  it.each(cases.map((c) => [c.case, c] as const))('%s', (_, c) => {
    const got = inlineArtifactsByGroup(c.groups, c.artifacts);
    expect(Object.fromEntries([...got].map(([k, as]) => [String(k), as.map((a) => a.id)]))).toEqual(c.expected);
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
    expect(readFrameHeight({ type: 'omni:artifact-height', height: 412.2 })).toBe(413);
    expect(readFrameHeight({ type: 'omni:artifact-height', height: 1e9 })).toBe(INLINE_MAX_HEIGHT);
  });

  it('ignores anything else a page posts', () => {
    for (const d of [null, 'omni:artifact-height', { type: 'other', height: 10 }, { type: 'omni:artifact-height', height: -5 }, { type: 'omni:artifact-height', height: Infinity }, { type: 'omni:artifact-height', height: '300' }]) {
      expect(readFrameHeight(d)).toBeUndefined();
    }
  });
});
