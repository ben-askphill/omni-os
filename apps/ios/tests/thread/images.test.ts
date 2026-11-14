import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';

import { gateReplyImages, replyImageAllowed } from '../../src/thread/images';

const ORIGIN = 'https://omni.example.ts.net';

describe('agent reply images (S18)', () => {
  it.each([
    ['https://example.com/shot.png', true],
    ['data:image/png;base64,AAAA', true],
    ['http://example.com/shot.png', false],
    ['https://other.example/api/threads/t/terminal/stream', false],
    ['https://other.example/%61pi/threads/t/terminal', false],
    ['https://omni.example.ts.net/a.png', false],
    ['http://127.0.0.1:4747/x.png', false],
    ['/api/channels/c/prs/1/image', false],
    ['/api/threads/t/terminal/stream', false],
    ['data:image/svg+xml;base64,AAAA', false],
    ['javascript:alert(1)', false],
  ])('%s → %s', (src, allowed) => {
    expect(replyImageAllowed(src, ORIGIN)).toBe(allowed);
  });

  it('writes a refused image as text and keeps an allowed one', () => {
    const md = 'See ![shot](https://example.com/a.png) and ![term](/api/threads/t/terminal/stream).';
    expect(gateReplyImages(md, ORIGIN)).toBe('See ![shot](https://example.com/a.png) and \\[image: term\\].');
  });

  it('catches reference images and raw <img> tags', () => {
    const md = '![x][r]\n\n<img src="/api/threads/t/browser/start">\n\n[r]: https://other.example/api/x';
    const out = gateReplyImages(md, ORIGIN);
    expect(out).not.toContain('![x][r]');
    expect(out).not.toContain('<img');
    expect(out).toContain('\\[image: x\\]');
  });

  it.each([
    ['a list item with alt text over two lines', '- ![a\n b](http://127.0.0.1:4747/api/x)'],
    ['a blockquote with alt text over two lines', '> ![a\n> b](http://127.0.0.1:4747/api/x)'],
    ['a list item with a title over two lines', '- ![a](http://127.0.0.1:4747/api/x\n "t\n u")'],
  ])('leaves no loadable image in %s', (_, md) => {
    const out = gateReplyImages(md, ORIGIN);
    const images: string[] = [];
    new Marked({ gfm: true }).walkTokens(new Marked({ gfm: true }).lexer(out), (t) => {
      if (t.type === 'image') images.push(t.href);
    });
    expect(images).toEqual([]);
    expect(out).not.toBe(md);
  });

  it('leaves text without images alone', () => {
    expect(gateReplyImages('Just [a link](https://example.com).', ORIGIN)).toBe('Just [a link](https://example.com).');
  });
});
