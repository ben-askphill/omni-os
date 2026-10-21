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
