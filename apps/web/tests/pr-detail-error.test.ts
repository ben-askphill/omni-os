// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel } from '../src/api.ts';

// A PR link opens Omni's PR page instead of GitHub (pr-links.ts). When gh cannot read the PR (signed out, rate
// limited, offline, a renamed repo), the page says why and still offers the PR on GitHub.

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async () => {
    throw new Error('gh: To get started with GitHub CLI, please run: gh auth login');
  }) as typeof actual.api.get;
  return actual;
});

const { PRDetail } = await import('../src/pages/PRs.tsx');
const { onLinkClick, setKnownChannels } = await import('../src/pr-links.ts');

const channel = { id: 'shop', name: 'Acme Shop', github_repo: 'acme/shop' } as Channel;

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  location.hash = '#/c/shop/prs/12';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(PRDetail, { channel, n: 12 })));
  await act(async () => {});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('offers the PR on GitHub when gh cannot read it', () => {
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('gh auth login');
  const link = [...host.querySelectorAll('a')].find((a) => a.textContent?.includes('Open on GitHub'));
  expect(link?.getAttribute('href')).toBe('https://github.com/acme/shop/pull/12');
  expect(link?.getAttribute('target')).toBe('_blank');
  expect(link?.hasAttribute('data-external')).toBe(true);
});

it('sends that link to GitHub, not back to the PR page', () => {
  setKnownChannels([channel]);
  location.hash = '#/c/shop/threads';
  document.addEventListener('click', onLinkClick);
  try {
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent?.includes('Open on GitHub'))!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(location.hash).toBe('#/c/shop/threads');
  } finally {
    document.removeEventListener('click', onLinkClick);
  }
});
