import { beforeEach, describe, expect, it } from 'vitest';
import { linkIconsSource } from '../scripts/build-link-icons.ts';
import { readFileSync } from 'node:fs';
import { LINK_ICONS } from '../shared/link-icons.ts';
import { SOURCES } from '../shared/link-sources.ts';
import { clearLinkCache, isApiHost, isPrivateAddress, publicLookup, resolveLink, resolveLinks, titleFromHtml, type LinkDeps } from '../server/links.ts';

function deps(over: Partial<LinkDeps> = {}, secrets: Record<string, string> = {}) {
  const calls: string[] = [];
  const d: LinkDeps = {
    secret: async (n) => secrets[n],
    json: async (url) => {
      calls.push(url);
      throw new Error('no api in tests');
    },
    gh: async (...args) => {
      calls.push(`gh ${args.join(' ')}`);
      throw new Error('no gh in tests');
    },
    pageTitle: async (url) => {
      calls.push(`page ${url}`);
      return undefined;
    },
    artifact: () => undefined,
    ...over,
  };
  return { d, calls };
}

beforeEach(clearLinkCache);

describe('resolveLink', () => {
  it('names a GitHub pull with its title and merged state', async () => {
    const { d } = deps({ gh: async (path) => (path === 'repos/a/b/issues/7' ? { title: 'Fix the cart', state: 'closed', pull_request: { merged_at: '2026-01-01' } } : {}) });
    expect(await resolveLink('https://github.com/a/b/pull/7', d)).toMatchObject({ ref: '#7', text: 'Fix the cart', state: 'Merged', resolved: true });
  });

  it('asks Azure DevOps with the PAT, and says which secret is missing without one', async () => {
    const seen: { url: string; auth?: string }[] = [];
    const { d } = deps(
      {
        json: async (url, init) => {
          seen.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
          return { fields: { 'System.Title': 'Localization setup', 'System.State': 'Active', 'System.WorkItemType': 'User Story' } };
        },
      },
      { AZURE_DEVOPS_PAT: 'pat' },
    );
    const url = 'https://dev.azure.com/acne/Web/_workitems/edit/29549';
    expect(await resolveLink(url, d)).toMatchObject({ ref: '29549', text: 'Localization setup', state: 'Active', context: 'User Story', icon: 'microsoft' });
    expect(seen[0].url).toContain('https://dev.azure.com/acne/Web/_apis/wit/workitems/29549?');
    expect(seen[0].auth).toBe(`Basic ${Buffer.from(':pat').toString('base64')}`);
    expect(await resolveLink(url, deps().d)).toMatchObject({ text: 'Work item 29549', resolved: false, needs: 'AZURE_DEVOPS_PAT' });
  });

  it('reads Productive with the org from the URL', async () => {
    let headers: Record<string, string> = {};
    const { d } = deps(
      {
        json: async (_url, init) => {
          headers = init?.headers as Record<string, string>;
          return { data: { attributes: { title: 'Swatches show +1', closed: true } } };
        },
      },
      { PRODUCTIVE_API_KEY: 'k' },
    );
    expect(await resolveLink('https://app.productive.io/21562-ask-phill/task/19711159', d)).toMatchObject({ text: 'Swatches show +1', state: 'Closed' });
    expect(headers['X-Organization-Id']).toBe('21562');
  });

  it('keeps the slug title when a source has no credentials', async () => {
    const { d, calls } = deps();
    expect(await resolveLink('https://www.notion.so/x/Plan-0123456789abcdef0123456789abcdef', d)).toMatchObject({ text: 'Plan', resolved: false });
    expect(calls).toEqual([]);
  });

  it('falls back to the page title for an unknown public page, and to the URL when that fails', async () => {
    const { d } = deps({ pageTitle: async () => ({ title: 'Example Domain', site: 'Example' }) });
    expect(await resolveLink('https://example.com/', d)).toMatchObject({ source: 'web', text: 'Example Domain', context: 'Example', resolved: true });
    const failing = deps({ json: async () => ({}), gh: async () => ({}), pageTitle: async () => { throw new Error('down'); } }).d;
    expect(await resolveLink('https://example.com/a', failing)).toMatchObject({ text: 'example.com/a', resolved: false });
  });

  it('does not take a Google sign-in page as a document title', async () => {
    const { d } = deps({ pageTitle: async () => ({ title: 'Google Docs: Sign-in' }) });
    expect(await resolveLink('https://docs.google.com/document/d/abc/edit', d)).toMatchObject({ text: 'Google Doc', resolved: false });
    const shared = deps({ pageTitle: async () => ({ title: 'Brief - Google Docs' }) }).d;
    expect(await resolveLink('https://docs.google.com/document/d/abc/edit', shared)).toMatchObject({ text: 'Brief', resolved: true });
  });

  it('names a claude.ai artifact from the one Omni published', async () => {
    const { d } = deps({ artifact: () => ({ name: 'omni-os-landing.html', description: 'Landing page' }) });
    expect(await resolveLink('https://claude.ai/artifact/81X3', d)).toMatchObject({ text: 'omni-os-landing.html', context: 'Landing page' });
  });
});

describe('resolveLinks', () => {
  it('asks once per URL and channel, failures included', async () => {
    let n = 0;
    const { d } = deps({ pageTitle: async () => { n++; return undefined; } });
    await resolveLinks(['https://a.example/', 'https://a.example/'], 'acme', d);
    await resolveLinks(['https://a.example/'], 'acme', d);
    expect(n).toBe(1);
    await resolveLinks(['https://a.example/'], 'other', d);
    expect(n).toBe(2);
  });
});

describe('safety', () => {
  it('never sends a Shopify token to a host a link names', async () => {
    const urls: string[] = [];
    const { d } = deps({ json: async (url) => (urls.push(url), {}) }, { SHOPIFY_ACCESS_TOKEN: 't' });
    await resolveLink('https://admin.shopify.com/store/evil.example%2Fx%23/products/1', d);
    await resolveLink('https://admin.shopify.com/store/volero-dev/products/1', d);
    expect(urls).toEqual(['https://volero-dev.myshopify.com/admin/api/2025-10/graphql.json']);
  });

  it('sends a GitLab token only to gitlab.com or GITLAB_HOST', async () => {
    const urls: string[] = [];
    const { d } = deps({ json: async (url) => (urls.push(url), { title: 'T', state: 'opened' }) }, { GITLAB_TOKEN: 't', GITLAB_HOST: 'gitlab.acme.dev' });
    await resolveLink('https://gitlab.evil.example/a/b/-/issues/1', d);
    await resolveLink('https://gitlab.acme.dev/a/b/-/issues/2', d);
    await resolveLink('https://gitlab.com/a/b/-/merge_requests/3', d);
    expect(urls.map((u) => new URL(u).host)).toEqual(['gitlab.acme.dev', 'gitlab.com']);
  });

  it('keeps ids that could move a request out of the API path', async () => {
    const urls: string[] = [];
    const { d } = deps({ json: async (url) => (urls.push(url), {}) }, { CLICKUP_TOKEN: 't' });
    await resolveLink('https://app.clickup.com/t/..%2F..%2Fuser', d);
    expect(urls).toEqual([]);
  });

  it('allows credentials only to known API hosts', () => {
    expect(isApiHost('dev.azure.com')).toBe(true);
    expect(isApiHost('volero-dev.myshopify.com')).toBe(true);
    expect(isApiHost('askphill.atlassian.net')).toBe(true);
    expect(isApiHost('evil.com.myshopify.com')).toBe(false);
    expect(isApiHost('example.com')).toBe(false);
    expect(isApiHost('gitlab.acme.dev', 'gitlab.acme.dev')).toBe(true);
  });

  it('refuses to connect to a name that resolves to a private address', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((r) => publicLookup('localhost', {}, (e) => r(e)));
    expect(err?.code).toBe('EPRIVATE');
  });

  it('treats private, loopback and link-local addresses as private', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '140.82.112.3', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('reads og:title before <title>, with entities decoded', () => {
    expect(titleFromHtml('<head><title>Plain</title><meta property="og:title" content="Rich &amp; full"><meta property="og:site_name" content="Site"></head>')).toEqual({ title: 'Rich & full', site: 'Site' });
    expect(titleFromHtml('<title>\n  Just &#39;this&#39;\n</title>')).toEqual({ title: "Just 'this'" });
  });
});

describe('link icons', () => {
  it('has a mark for every source', () => {
    for (const s of Object.values(SOURCES)) expect(LINK_ICONS[s.icon], s.name).toBeTruthy();
  });

  it('matches what the generator writes', () => {
    expect(readFileSync(new URL('../shared/link-icons.ts', import.meta.url), 'utf8')).toBe(linkIconsSource());
  });
});
