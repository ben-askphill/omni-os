import { describe, expect, it } from 'vitest';
import { parsePullRequestUrl, pullRequestPage, pullRequestUrl } from '../pr-links.ts';

describe('parsePullRequestUrl', () => {
  it('reads the repo and number of a PR and its tabs', () => {
    expect(parsePullRequestUrl('https://github.com/ben-askphill/omni-os/pull/745')).toEqual({ repo: 'ben-askphill/omni-os', number: 745 });
    expect(parsePullRequestUrl('https://github.com/ben-askphill/omni-os/pull/745/')).toEqual({ repo: 'ben-askphill/omni-os', number: 745 });
    for (const tab of ['files', 'commits', 'checks']) {
      expect(parsePullRequestUrl(`https://github.com/a/b.js/pull/9/${tab}`)).toEqual({ repo: 'a/b.js', number: 9 });
    }
    expect(parsePullRequestUrl('https://www.github.com/a/b/pull/3?w=1#issuecomment-12')).toEqual({ repo: 'a/b', number: 3 });
  });

  it('leaves every other link alone', () => {
    for (const url of [
      'https://github.com/a/b',
      'https://github.com/a/b/pulls',
      'https://github.com/a/b/issues/3',
      'https://github.com/a/b/pull/3/commits/abc1234',
      'https://github.com/a/b/pull/0',
      'https://github.com/a/b/pull/12x',
      'https://github.com/pulls',
      'https://gist.github.com/a/b/pull/3',
      'https://github.com.evil.dev/a/b/pull/3',
      'https://evil.dev/github.com/a/b/pull/3',
      'https://github.com:8443/a/b/pull/3',
      'https://user@github.com/a/b/pull/3',
      'ftp://github.com/a/b/pull/3',
      '#/c/x/prs/3',
      'not a url',
    ]) {
      expect(parsePullRequestUrl(url), url).toBeNull();
    }
  });
});

describe('pullRequestPage', () => {
  const channels = [
    { id: 'omni', github_repo: 'ben-askphill/omni-os' },
    { id: 'no-repo', github_repo: null },
    { id: 'omni-2', github_repo: 'Ben-AskPhill/Omni-OS' },
    { id: 'volero', github_repo: 'askphill/apa-volero' },
  ];

  it('finds the channel with the link repo, ignoring case', () => {
    expect(pullRequestPage('https://github.com/askphill/APA-volero/pull/88', channels)).toEqual({ channelId: 'volero', number: 88 });
    expect(pullRequestPage('https://github.com/ben-askphill/omni-os/pull/745/files', channels)).toEqual({ channelId: 'omni', number: 745 });
  });

  it('prefers the channel on screen when two share the repo', () => {
    expect(pullRequestPage('https://github.com/ben-askphill/omni-os/pull/1', channels, 'omni-2')).toEqual({ channelId: 'omni-2', number: 1 });
    expect(pullRequestPage('https://github.com/ben-askphill/omni-os/pull/1', channels, 'volero')).toEqual({ channelId: 'omni', number: 1 });
  });

  it('has no page for a repo no channel has, or a link that is not a PR', () => {
    expect(pullRequestPage('https://github.com/someone/else/pull/5', channels)).toBeNull();
    expect(pullRequestPage('https://github.com/ben-askphill/omni-os/issues/5', channels)).toBeNull();
    expect(pullRequestPage('https://github.com/ben-askphill/omni-os', channels)).toBeNull();
    expect(pullRequestPage('https://github.com/ben-askphill/omni-os/pull/5', [])).toBeNull();
  });
});

describe('pullRequestUrl', () => {
  it('builds the GitHub link the parser reads back', () => {
    expect(pullRequestUrl('acme/shop', 12)).toBe('https://github.com/acme/shop/pull/12');
    expect(parsePullRequestUrl(pullRequestUrl(' acme/shop ', 12))).toEqual({ repo: 'acme/shop', number: 12 });
  });
});
