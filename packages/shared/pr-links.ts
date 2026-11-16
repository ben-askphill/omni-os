// GitHub pull request links that Omni opens on its own PR page (#/c/<channel>/prs/<n>) instead of in the browser.
// The page reads the PR from the channel's repo, so a link has a page when a channel's GitHub repo is the link's repo.

export interface PullRequestRef {
  /** `owner/name`, as the link spells it. */
  repo: string;
  number: number;
}

// The PR itself, or one of its tabs. A commit inside a PR (`/pull/7/commits/<sha>`) is a commit link, not the PR.
const PR_PATH = /^\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)\/pull\/(\d+)(?:\/(?:files|commits|checks))?\/?$/;

/** The repo and number of a github.com pull request link, or null for any other link. The query and fragment are ignored. */
export function parsePullRequestUrl(url: string): PullRequestRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  if (u.port || u.username || u.password) return null;
  const m = PR_PATH.exec(u.pathname);
  if (!m) return null;
  const number = Number(m[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { repo: `${m[1]}/${m[2]}`, number };
}

/** The PR's page on GitHub, for a repo written `owner/name`. */
export const pullRequestUrl = (repo: string, number: number) => `https://github.com/${repo.trim()}/pull/${number}`;

export interface RepoChannel {
  id: string;
  github_repo?: string | null;
}

/**
 * The channel whose PR page shows `url`, and the PR's number. Null when the link is not a pull request or no channel
 * has its repo, so the link opens on GitHub. GitHub names are case-insensitive. When channels share the repo,
 * `prefer` (the channel on screen) wins, then the first in the list.
 */
export function pullRequestPage(url: string, channels: readonly RepoChannel[], prefer?: string | null): { channelId: string; number: number } | null {
  const pr = parsePullRequestUrl(url);
  if (!pr) return null;
  const repo = pr.repo.toLowerCase();
  const matches = channels.filter((c) => c.github_repo?.trim().toLowerCase() === repo);
  const channel = matches.find((c) => c.id === prefer) ?? matches[0];
  return channel ? { channelId: channel.id, number: pr.number } : null;
}
