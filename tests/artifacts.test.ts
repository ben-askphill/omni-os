import { describe, it, expect, vi } from 'vitest';

// artifacts.ts imports db.ts for the watcher. classify/mimeFor are pure; stub the db.
vi.mock('../server/db.ts', () => ({
  artifacts: { upsert: vi.fn(), remove: vi.fn() },
  threads: { get: vi.fn() },
}));

import { classify, mimeFor } from '../server/artifacts.ts';

describe('classify', () => {
  const T = '5a602d0a-4cfd-44ea-9394-6321d7529949';

  it.each([
    [`${T}/artifacts/report.html`, 'html'],
    [`${T}/artifacts/page.HTM`, 'html'],
    [`${T}/artifacts/notes.md`, 'markdown'],
    [`${T}/artifacts/diagram.svg`, 'svg'],
    [`${T}/artifacts/photo.JPG`, 'image'],
    [`${T}/artifacts/doc.pdf`, 'pdf'],
    [`${T}/artifacts/data.csv`, 'csv'],
    [`${T}/artifacts/data.json`, 'json'],
    [`${T}/artifacts/readme.txt`, 'text'],
    [`${T}/artifacts/nested/deep/chart.html`, 'html'],
  ])('%s -> %s', (rel, kind) => {
    expect(classify(rel)).toEqual({ threadId: T, kind });
  });

  it('turns browser images into screenshots', () => {
    expect(classify(`${T}/browser/page-1.png`)).toEqual({ threadId: T, kind: 'screenshot' });
    expect(classify(`${T}/browser/shot.webp`)).toEqual({ threadId: T, kind: 'screenshot' });
  });

  it('ignores non-image browser output', () => {
    expect(classify(`${T}/browser/trace.json`)).toBeNull();
    expect(classify(`${T}/browser/page.html`)).toBeNull();
  });

  it('ignores other areas, shallow paths, hidden files and unknown extensions', () => {
    expect(classify(`${T}/mcp.json`)).toBeNull();
    expect(classify(`${T}/other/report.html`)).toBeNull();
    expect(classify(`${T}/artifacts`)).toBeNull();
    expect(classify(`${T}`)).toBeNull();
    expect(classify(`${T}/artifacts/.report.html.swp`)).toBeNull();
    expect(classify(`${T}/artifacts/.DS_Store`)).toBeNull();
    expect(classify(`${T}/artifacts/archive.zip`)).toBeNull();
    expect(classify(`${T}/artifacts/noext`)).toBeNull();
  });
});

describe('mimeFor', () => {
  it('derives image types from the extension', () => {
    expect(mimeFor('/a/b.png', 'image')).toBe('image/png');
    expect(mimeFor('/a/b.JPG', 'image')).toBe('image/jpeg');
    expect(mimeFor('/a/b.jpeg', 'image')).toBe('image/jpeg');
    expect(mimeFor('/a/b.webp', 'screenshot')).toBe('image/webp');
  });

  it('maps document kinds', () => {
    expect(mimeFor('/a/b.html', 'html')).toBe('text/html; charset=utf-8');
    expect(mimeFor('/a/b.md', 'markdown')).toBe('text/markdown; charset=utf-8');
    expect(mimeFor('/a/b.svg', 'svg')).toBe('image/svg+xml');
    expect(mimeFor('/a/b.pdf', 'pdf')).toBe('application/pdf');
    expect(mimeFor('/a/b.csv', 'csv')).toBe('text/csv; charset=utf-8');
    expect(mimeFor('/a/b.json', 'json')).toBe('application/json');
    expect(mimeFor('/a/b.txt', 'text')).toBe('text/plain; charset=utf-8');
  });

  it('falls back to octet-stream', () => {
    expect(mimeFor('/a/b.bin', 'mystery')).toBe('application/octet-stream');
  });
});
