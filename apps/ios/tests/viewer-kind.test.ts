import { describe, expect, it } from 'vitest';

import { agoPhrase, cacheFileName, extensionOf, formatBytes, hasThumbnail, textPreview, TEXT_PREVIEW_LIMIT, tooLarge, viewerFor } from '../src/artifacts/viewer-kind';

describe('viewerFor', () => {
  it('opens every server kind', () => {
    expect(['html', 'svg', 'markdown', 'image', 'screenshot', 'pdf', 'csv', 'json', 'text'].map(viewerFor)).toEqual(['page', 'svg', 'markdown', 'image', 'image', 'pdf', 'table', 'text', 'text']);
  });

  it('falls back to a file for a kind it does not know', () => {
    expect(viewerFor('zip')).toBe('file');
    expect(viewerFor('')).toBe('file');
  });

  it('draws a thumbnail for images only', () => {
    expect(hasThumbnail('image')).toBe(true);
    expect(hasThumbnail('screenshot')).toBe(true);
    expect(hasThumbnail('html')).toBe(false);
    expect(hasThumbnail('pdf')).toBe(false);
  });
});

describe('cacheFileName', () => {
  it('changes when the file is rewritten', () => {
    const a = cacheFileName({ id: 7, name: 'r.html', updated_at: '2026-11-02T09:00:00Z' });
    const b = cacheFileName({ id: 7, name: 'r.html', updated_at: '2026-11-02T09:00:01Z' });
    expect(a).toBe('7-20261102T090000Z.html');
    expect(b).not.toBe(a);
  });

  it('cannot leave the cache folder', () => {
    const name = cacheFileName({ id: 1, name: '../../x.h/../tml', updated_at: '../..' });
    expect(name).not.toMatch(/[/\\]/);
    expect(name).not.toContain('..');
  });

  it('uses a plain extension for odd names', () => {
    expect(extensionOf('README')).toBe('file');
    expect(extensionOf('a.tar.GZ')).toBe('gz');
    expect(cacheFileName({ id: 1, name: 'x.<b>', updated_at: 'v' })).toBe('1-v.b');
  });
});

describe('tooLarge', () => {
  it('stops at the fetch limit', () => {
    expect(tooLarge({ size: 25 * 1024 * 1024 })).toBe(false);
    expect(tooLarge({ size: 25 * 1024 * 1024 + 1 })).toBe(true);
  });
});

describe('agoPhrase and formatBytes', () => {
  it('reads as a phrase', () => {
    expect(agoPhrase('now')).toBe('just now');
    expect(agoPhrase('5m')).toBe('5m ago');
    expect(agoPhrase('3d')).toBe('3d ago');
    expect(agoPhrase('12 Oct')).toBe('on 12 Oct');
    expect(agoPhrase('')).toBe('');
  });

  it('sizes in B, KB and MB', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024)).toBe('20 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('textPreview', () => {
  it('pretty-prints json and leaves broken json alone', () => {
    expect(textPreview('{"a":1,"b":[2]}', 'json').text).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(textPreview('{oops', 'json').text).toBe('{oops');
    expect(textPreview('{"a":1}', 'text').text).toBe('{"a":1}');
  });

  it('cuts a long file and says so', () => {
    const long = 'x'.repeat(TEXT_PREVIEW_LIMIT + 5);
    const out = textPreview(long, 'text');
    expect(out.truncated).toBe(true);
    expect(out.text).toHaveLength(TEXT_PREVIEW_LIMIT);
    expect(textPreview('short', 'text')).toEqual({ text: 'short', truncated: false });
  });
});
