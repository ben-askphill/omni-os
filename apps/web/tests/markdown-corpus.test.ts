import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/components/Markdown.tsx';

// `web` is the checked-in HTML from Markdown.tsx (react-dom/server renderToStaticMarkup).
// Updating it is a deliberate commit.

interface Snippet {
  id: string;
  source: string;
  web: string;
}

interface Corpus {
  snippets: Snippet[];
}

const corpus = JSON.parse(readFileSync(fixture('markdown', 'corpus.json'), 'utf8')) as Corpus;

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
  it('holds ordinary GFM, each snippet once', () => {
    const ids = corpus.snippets.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ordinary) expect(ids).toContain(id);
    for (const snippet of corpus.snippets) {
      expect(snippet.source.length).toBeGreaterThan(0);
      expect(snippet.web.length).toBeGreaterThan(0);
    }
  });

  for (const snippet of corpus.snippets) {
    it(`${snippet.id} matches the checked-in web HTML`, () => {
      expect(render(snippet.source)).toBe(snippet.web);
    });
  }
});
