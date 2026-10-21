import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by github image tests');
});

import { githubImage, githubImageSources, proxyPRImages, signedImageURLs } from '../github-images.ts';

const P = '/api/channels/c1/prs/7/image?src=';
const via = (src: string) => P + encodeURIComponent(src);

const BLOB = 'https://github.com/ben-askphill/omni-os/blob/pr-screenshots/omni-0157e314/drawer-before-390.png?raw=true';
const ASSET = 'https://github.com/user-attachments/assets/4f6a2c1e-9b3d-4e8f-a1b2-c3d4e5f6a7b8';

describe('githubImage', () => {
  it('reads repo files from blob, raw and raw.githubusercontent URLs', () => {
    expect(githubImage(BLOB)).toEqual({ kind: 'file', repo: 'ben-askphill/omni-os', rest: ['pr-screenshots', 'omni-0157e314', 'drawer-before-390.png'] });
    expect(githubImage('https://github.com/o/r/raw/main/a.png')).toEqual({ kind: 'file', repo: 'o/r', rest: ['main', 'a.png'] });
    expect(githubImage('https://raw.githubusercontent.com/o/r/feat/x/docs/a.png')).toEqual({ kind: 'file', repo: 'o/r', rest: ['feat', 'x', 'docs', 'a.png'] });
  });

  it('reads uploads by their asset id', () => {
    expect(githubImage(ASSET)).toEqual({ kind: 'attachment', key: '4f6a2c1e-9b3d-4e8f-a1b2-c3d4e5f6a7b8' });
    expect(githubImage('https://github.com/o/r/assets/12345/4F6A2C1E-9B3D-4E8F-A1B2-C3D4E5F6A7B8')).toEqual({ kind: 'attachment', key: '4f6a2c1e-9b3d-4e8f-a1b2-c3d4e5f6a7b8' });
    expect(githubImage('https://private-user-images.githubusercontent.com/99/1234-4f6a2c1e-9b3d-4e8f-a1b2-c3d4e5f6a7b8.png?jwt=abc')).toEqual({
      kind: 'attachment',
      key: '4f6a2c1e-9b3d-4e8f-a1b2-c3d4e5f6a7b8',
    });
  });

  it('leaves every other URL alone', () => {
    for (const src of ['https://img.shields.io/badge/x-y-green', 'https://github.com/o/r/pull/3', 'http://github.com/o/r/blob/main/a.png', '/api/x', 'data:image/png;base64,AA', 'not a url'])
      expect(githubImage(src)).toBeNull();
  });
});

describe('proxyPRImages', () => {
  it('points markdown images on GitHub at the proxy and keeps the alt text', () => {
    const md = `**390px, before:** X and collapse-all overlap.\n![drawer before 390](${BLOB})`;
    expect(proxyPRImages(md, P)).toBe(`**390px, before:** X and collapse-all overlap.\n![drawer before 390](${via(BLOB)})`);
  });

  it('turns <img> tags into markdown images, proxied when on GitHub', () => {
    expect(proxyPRImages(`<img width="390" alt="Screenshot 2026-10-21" src="${ASSET}" />`, P)).toBe(`![Screenshot 2026-10-21](<${via(ASSET)}>)`);
    expect(proxyPRImages(`<IMG src='https://example.com/a.png' alt="a [b] &amp; c">`, P)).toBe('![a \\[b\\] & c](<https://example.com/a.png>)');
    expect(proxyPRImages('<img alt="no source">', P)).toBe('<img alt="no source">');
  });

  it('keeps titles, angle-bracket destinations and linked images working', () => {
    expect(proxyPRImages(`![a](${ASSET} "Title")`, P)).toBe(`![a](${via(ASSET)} "Title")`);
    expect(proxyPRImages(`![a](<${ASSET}>)`, P)).toBe(`![a](<${via(ASSET)}>)`);
    expect(proxyPRImages(`[![a](${ASSET})](https://example.com)`, P)).toBe(`[![a](${via(ASSET)})](https://example.com)`);
  });

  it('leaves other images, plain links and code untouched', () => {
    const md = [
      '![badge](https://img.shields.io/badge/a-b-c)',
      `[the file](${BLOB})`,
      `\`![inline](${ASSET})\``,
      '```',
      `<img src="${ASSET}">`,
      '```',
    ].join('\n');
    expect(proxyPRImages(md, P)).toBe(md);
  });
});

describe('githubImageSources', () => {
  it('lists the GitHub images a body shows, the only ones the proxy will serve', () => {
    const md = `![a](${BLOB})\n<img src="${ASSET}">\n![badge](https://img.shields.io/x)\n[link](https://github.com/o/r/blob/main/secret.png)\n\`![code](${ASSET}?x)\``;
    expect(githubImageSources(md)).toEqual([ASSET, BLOB]);
  });
});

describe('signedImageURLs', () => {
  it('pulls signed upload URLs out of rendered HTML and decodes &amp;', () => {
    const html =
      '<p><a target="_blank" href="https://private-user-images.githubusercontent.com/9/1-aa.png?jwt=x&amp;y=1"><img src="https://private-user-images.githubusercontent.com/9/1-aa.png?jwt=x&amp;y=1" alt="a"></a></p><img src="https://example.com/b.png">';
    expect(signedImageURLs(html)).toEqual(['https://private-user-images.githubusercontent.com/9/1-aa.png?jwt=x&y=1', 'https://private-user-images.githubusercontent.com/9/1-aa.png?jwt=x&y=1']);
  });
});
