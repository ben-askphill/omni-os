import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../web/src/components/Markdown.tsx';

// The Web UI and the Mac app read this one file. `web` is the checked-in HTML from
// Markdown.tsx (react-dom/server renderToStaticMarkup). Updating it is a deliberate
// commit. The Mac tree is `mac`; MarkdownCorpusTests.swift checks that. Do not copy
// the file into OmniKit Fixtures.

interface CorpusRun {
  text: string;
  style?: string[];
  link?: string;
  image?: string;
}

interface CorpusBlock {
  type: string;
  runs?: CorpusRun[];
  level?: number;
  language?: string;
  code?: string;
  ordered?: boolean;
  start?: number;
  loose?: boolean;
  items?: { checked?: boolean | null; blocks: CorpusBlock[] }[];
  align?: (string | null)[];
  head?: CorpusRun[][];
  rows?: CorpusRun[][][];
  blocks?: CorpusBlock[];
  html?: string;
}

interface Snippet {
  id: string;
  source: string;
  difference: string | null;
  web: string;
  mac: CorpusBlock[];
}

interface Corpus {
  acceptedDifferences: { name: string; summary: string }[];
  snippets: Snippet[];
}

const corpus = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/markdown/corpus.json'), 'utf8')) as Corpus;

const ordinary = [
  'heading',
  'unordered-list',
  'ordered-list',
  'task-list',
  'table',
  'code-fence',
  'link',
  'bare-url',
  'bare-thread-id',
];

function render(source: string) {
  return renderToStaticMarkup(createElement(Markdown, { text: source }));
}

describe('markdown fixture corpus', () => {
  it('names every accepted difference and keeps ordinary GFM', () => {
    const accepted = corpus.acceptedDifferences.map((d) => d.name);
    expect(new Set(accepted).size).toBe(accepted.length);
    expect(corpus.acceptedDifferences.every((d) => d.name.length > 0 && d.summary.length > 0)).toBe(true);

    const ids = corpus.snippets.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const used = new Set(corpus.snippets.flatMap((s) => (s.difference === null ? [] : [s.difference])));
    expect([...used].sort()).toEqual([...accepted].sort());

    for (const id of ordinary) {
      expect(corpus.snippets.some((s) => s.id === id && s.difference === null)).toBe(true);
    }
    for (const snippet of corpus.snippets) {
      expect(snippet.source.length).toBeGreaterThan(0);
      expect(snippet.web.length).toBeGreaterThan(0);
      expect(snippet.mac.length).toBeGreaterThan(0);
      if (snippet.difference !== null) expect(accepted).toContain(snippet.difference);
    }
  });

  for (const snippet of corpus.snippets) {
    it(`${snippet.id} matches the checked-in web HTML`, () => {
      expect(render(snippet.source)).toBe(snippet.web);
    });
  }
});
