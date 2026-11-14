import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/components/Markdown.tsx';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('markdown images', () => {
  it('renders an image the server proxies, under its caption, opening full size on click', () => {
    const src = '/api/channels/omni-os/prs/271/image?src=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fblob%2Fmain%2Fa.png';
    const html = render(`**390px, before:** overlap.\n![drawer before 390](${src})`);
    expect(html).toContain(`<img src="${src.replace(/&/g, '&amp;')}" alt="drawer before 390" loading="lazy" class="cursor-zoom-in"/>`);
    expect(html).not.toMatch(/overlap\. drawer before 390/);
  });

  it('does not make an image with no loadable source clickable', () => {
    expect(render('![x](javascript:alert(1))')).not.toContain('cursor-zoom-in');
  });
});

describe('markdown images that would act (S18)', () => {
  const gated = (text: string) => renderToStaticMarkup(createElement(Markdown, { text, gateRemoteImages: true }));

  it.each([
    '/api/threads/t1/terminal/stream',
    '/api/channels/omni/browser/stream',
    'http://localhost:4747/api/threads/t1/terminal/stream',
    'http://127.0.0.1:4748/api/threads/t1/terminal/stream',
    '/api/channels/c/prs/1/image/../../../../threads/t/terminal/stream',
    'http://127.0.0.1:4748/%61pi/threads/t/terminal/stream',
    'https://other.example/API/threads/t/terminal/stream',
    'http://localhost:3000/a.png',
  ])('never renders an <img> for %s, in replies or PR text', (src) => {
    for (const html of [render(`![shot](${src})`), gated(`![shot](${src})`)]) {
      expect(html).not.toContain('<img');
      expect(html).toContain('[image: shot]');
    }
  });

  it('loads another site image in replies, and waits for a click in PR text', () => {
    expect(render('![shot](https://example.com/a.png)')).toContain('<img src="https://example.com/a.png"');
    const html = gated('![shot](https://example.com/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('Load image &quot;shot&quot; from example.com');
  });

  it('still loads the PR image proxy in PR text', () => {
    const src = '/api/channels/omni-os/prs/271/image?src=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fa.png';
    expect(gated(`![shot](${src})`)).toContain(`<img src="${src.replace(/&/g, '&amp;')}"`);
  });
});
