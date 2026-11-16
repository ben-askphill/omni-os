// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onLinkClick, openOnGitHub, openPullRequestLink, setKnownChannels } from '../src/pr-links.ts';

// A GitHub PR link opens the PR's page in Omni when a channel has the link's repo, and GitHub otherwise. These drive the
// document listener with real clicks on real anchors, the way a reply, a card or a list row is clicked.

const channels = [
  { id: 'omni', github_repo: 'ben-askphill/omni-os' },
  { id: 'volero', github_repo: 'askphill/apa-volero' },
];

let host: HTMLElement;

function link(url: string, attrs: Record<string, string> = {}) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = 'link';
  host.append(a);
  return a;
}

/** Clicks `el` and says whether the page took the click (the browser would not follow the link). */
function click(el: Element, init: MouseEventInit = {}) {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(e);
  return e.defaultPrevented;
}

beforeEach(() => {
  location.hash = '#/t/abc';
  setKnownChannels(channels);
  host = document.createElement('div');
  document.body.append(host);
  document.addEventListener('click', onLinkClick);
});
afterEach(() => {
  document.removeEventListener('click', onLinkClick);
  host.remove();
  vi.restoreAllMocks();
});

describe('PR link clicks', () => {
  it('open a known PR on its Omni page', () => {
    expect(click(link('https://github.com/ben-askphill/omni-os/pull/745'))).toBe(true);
    expect(location.hash).toBe('#/c/omni/prs/745');
  });

  it('take a click on something inside the link, and the PR tabs', () => {
    const a = link('https://github.com/AskPhill/apa-volero/pull/88/files');
    const inner = document.createElement('span');
    a.append(inner);
    expect(click(inner)).toBe(true);
    expect(location.hash).toBe('#/c/volero/prs/88');
  });

  it('leave a PR no channel has to GitHub', () => {
    expect(click(link('https://github.com/someone/else/pull/5'))).toBe(false);
    expect(location.hash).toBe('#/t/abc');
  });

  it('leave GitHub links that are not PRs to GitHub', () => {
    for (const url of ['https://github.com/ben-askphill/omni-os', 'https://github.com/ben-askphill/omni-os/issues/5', 'https://github.com/ben-askphill/omni-os/pull/5/commits/abc1234', 'https://example.com/pull/5']) {
      expect(click(link(url)), url).toBe(false);
    }
    expect(location.hash).toBe('#/t/abc');
  });

  it('send a modifier click, a middle click and an Open on GitHub link to GitHub', () => {
    const url = 'https://github.com/ben-askphill/omni-os/pull/745';
    for (const mod of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) expect(click(link(url), { [mod]: true }), mod).toBe(false);
    expect(click(link(url), { button: 1 })).toBe(false);
    expect(click(link(url, { 'data-external': '' }))).toBe(false);
    const wrapped = document.createElement('div');
    wrapped.setAttribute('data-external', '');
    host.append(wrapped);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    wrapped.append(a);
    expect(click(a)).toBe(false);
    expect(location.hash).toBe('#/t/abc');
  });

  it('send a link to the PR page on screen to GitHub', () => {
    location.hash = '#/c/omni/prs/745';
    expect(click(link('https://github.com/ben-askphill/omni-os/pull/745'))).toBe(false);
    expect(click(link('https://github.com/ben-askphill/omni-os/pull/746'))).toBe(true);
    expect(location.hash).toBe('#/c/omni/prs/746');
  });

  it('leave a link whose own handler took the click', () => {
    const a = link('https://github.com/ben-askphill/omni-os/pull/745');
    a.addEventListener('click', (e) => e.preventDefault());
    click(a);
    expect(location.hash).toBe('#/t/abc');
  });

  it('prefer the channel on screen when two share the repo', () => {
    setKnownChannels([...channels, { id: 'omni-b', github_repo: 'ben-askphill/omni-os' }], 'omni-b');
    click(link('https://github.com/ben-askphill/omni-os/pull/9'));
    expect(location.hash).toBe('#/c/omni-b/prs/9');
  });
});

// The desktop app asks the page about PR links it would hand to the browser (desktop.routeLinks).
describe('openPullRequestLink', () => {
  it('opens a known PR and refuses the rest', () => {
    expect(openPullRequestLink('https://github.com/ben-askphill/omni-os/pull/12')).toBe(true);
    expect(location.hash).toBe('#/c/omni/prs/12');
    expect(openPullRequestLink('https://github.com/someone/else/pull/5')).toBe(false);
    expect(openPullRequestLink('https://github.com/ben-askphill/omni-os/issues/5')).toBe(false);
  });

  it('refuses a link the page just sent to GitHub, once', () => {
    const url = 'https://github.com/ben-askphill/omni-os/pull/13';
    click(link(url), { metaKey: true });
    expect(openPullRequestLink(url)).toBe(false);
    expect(location.hash).toBe('#/t/abc');
    expect(openPullRequestLink(url)).toBe(true);
  });

  it('refuses what an Open on GitHub button opened', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const url = 'https://github.com/ben-askphill/omni-os/pull/14';
    openOnGitHub(url);
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    expect(openPullRequestLink(url)).toBe(false);
    expect(location.hash).toBe('#/t/abc');
  });
});
