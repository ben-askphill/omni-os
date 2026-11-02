import { describe, expect, it } from 'vitest';

import { markdownDocument } from '../src/artifacts/markdown';

const colors = { bg: '#fff', fg: '#000', fg2: '#333', fg3: '#666', surface: '#eee', line: '#ddd' };
const render = (src: string) => markdownDocument(src, colors);

describe('markdownDocument', () => {
  it('renders the usual blocks', () => {
    const out = render('# Title\n\nSome **bold** and `code`.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<li>a</li>');
    expect(out).toContain('<table>');
  });

  it('shows raw HTML as text, so no tag or script gets through', () => {
    const out = render('hi <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://evil.test"></iframe>');
    const body = out.slice(out.indexOf('<body>'));
    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('<iframe');
    expect(body).toContain('&lt;script&gt;');
  });

  it('drops links that are not web, mail or in-page', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'omni://x']) {
      const body = render(`[go](${href})`).slice(render('').indexOf('<body>'));
      expect(body).not.toContain(href);
    }
    expect(render('[ok](https://example.com)')).toContain('href="https://example.com"');
    expect(render('[ok](mailto:a@b.co)')).toContain('href="mailto:a@b.co"');
    expect(render('[ok](#top)')).toContain('href="#top"');
  });

  it('loads images only from https or as inline pictures', () => {
    expect(render('![a](https://example.com/a.png)')).toContain('src="https://example.com/a.png"');
    expect(render('![a](data:image/png;base64,AAAA)')).toContain('src="data:image/png;base64,AAAA"');
    for (const src of ['http://example.com/a.png', 'file:///a.png', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)']) {
      expect(render(`![a](${src})`)).not.toContain(`src="${src}"`);
    }
  });
});
