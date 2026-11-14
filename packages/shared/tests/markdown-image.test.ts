import { describe, expect, it } from 'vitest';
import { imageSource } from '../markdown-image.ts';

const ORIGIN = 'http://127.0.0.1:4747';

describe('imageSource', () => {
  it.each([
    ['/api/threads/t1/terminal/stream', 'api'],
    ['api/threads/t1/terminal/stream', 'api'],
    ['./api/channels/c/browser/stream', 'api'],
    ['/api/channels/c/browser/stream', 'api'],
    ['http://127.0.0.1:4747/api/threads/t1/terminal/stream', 'api'],
    ['//127.0.0.1:4747/api/threads/t1/terminal/stream', 'api'],
    ['http://127.0.0.1:4748/api/threads/t1/terminal/stream', 'api'],
    ['http://localhost:4747/api/threads/t1/terminal', 'api'],
    ['https://omarchy-1.omni-os.app/api/threads/t1/terminal/stream', 'api'],
    ['/api/channels/c/prs/1/image/../../../../threads/t/terminal/stream', 'api'],
    ['/api/channels/c/prs/1/image/%2e%2e/%2e%2e/%2e%2e/%2e%2e/threads/t/terminal/stream', 'api'],
    ['/api', 'api'],
    ['/favicon.svg', 'invalid'],
    ['javascript:alert(1)', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['data:image/svg+xml;base64,PHN2Zz4=', 'scheme'],
    ['https://user:pw@example.com/a.png', 'invalid'],
    ['', 'invalid'],
    [undefined, 'invalid'],
  ])('refuses %s (%s)', (src, reason) => {
    expect(imageSource(src, ORIGIN)).toEqual({ kind: 'refused', reason });
  });

  it('loads the PR image proxy on this origin', () => {
    const src = '/api/channels/omni-os/prs/271/image?src=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fa.png';
    expect(imageSource(src, ORIGIN)).toEqual({ kind: 'load', src });
  });

  it('loads an inline raster picture', () => {
    expect(imageSource('data:image/png;base64,iVBOR', ORIGIN)).toEqual({ kind: 'load', src: 'data:image/png;base64,iVBOR' });
  });

  it('marks another site image as remote, with its host', () => {
    expect(imageSource('https://example.com/shot.png', ORIGIN)).toEqual({ kind: 'remote', src: 'https://example.com/shot.png', host: 'example.com' });
  });

  it('does not take the PR proxy path on another origin', () => {
    expect(imageSource('http://127.0.0.1:9999/api/channels/c/prs/1/image?src=x', ORIGIN)).toEqual({ kind: 'refused', reason: 'api' });
  });
});
