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

  it('leaves text without images alone', () => {
    expect(gateReplyImages('Just [a link](https://example.com).', ORIGIN)).toBe('Just [a link](https://example.com).');
  });
});
