import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LinkPreview } from '../src/link-previews.ts';

// An outside link's preview (components/LinkChip.tsx, audit M29): a tooltip on hover and keyboard focus instead of a
// `title`, and the "Add the secret" hint inline after the link, where touch and keyboard users see it too.

const preview = vi.hoisted(() => ({ current: null as LinkPreview | null }));
vi.mock('../src/link-previews.ts', () => ({ useLinkPreview: () => preview.current }));

import { ExternalLink } from '../src/components/LinkChip.tsx';

const url = 'https://dev.azure.com/acme/shop/_workitems/edit/29549';
const base: LinkPreview = { url, source: 'azure-devops', icon: 'azure-devops', name: 'Azure DevOps', kind: 'work item', ref: '29549', text: 'Fix the cart', resolved: true };
const render = () => renderToStaticMarkup(createElement(ExternalLink, { href: url }, url));

describe('ExternalLink preview', () => {
  it('puts the preview in a tooltip that describes the link, not in a title', () => {
    preview.current = { ...base, context: 'acme/shop', state: 'Active' };
    const html = render();
    expect(html).not.toContain('title=');
    const id = html.match(/<a aria-describedby="(tip-[^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}" role="tooltip" class="tip"`);
    expect(html).toContain(`>Azure DevOps · acme/shop · Active\n29549 Fix the cart\n${url}</span>`);
    expect(html).not.toContain('link-needs');
  });

  it('says inline which secret would show its title', () => {
    preview.current = { ...base, resolved: false, text: '29549', needs: 'AZURE_DEVOPS_PAT' };
    const html = render();
    expect(html).toContain('<span class="link-needs">Add the AZURE_DEVOPS_PAT secret to show titles from Azure DevOps.</span>');
    // Not in the tip as well.
    expect(html.match(/secret to show titles/g)).toHaveLength(1);
  });

  it('has no tip for a link nothing knows about', () => {
    preview.current = null;
    const html = render();
    expect(html).toBe(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  });
});
