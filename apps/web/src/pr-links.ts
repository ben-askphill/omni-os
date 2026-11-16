// A GitHub pull request link opens the PR's page in Omni (#/c/<channel>/prs/<n>) when a channel has the link's repo
// (@omni/shared/pr-links.ts), wherever the link is: a reply, a card, a chip, a list row. A click with a modifier, a link
// marked `data-external` ("Open on GitHub") and a PR Omni has no page for open on GitHub as before. So does a link to
// the PR page already on screen. In the desktop app the main process asks the same of links in an agent's HTML, a
// sandboxed frame whose clicks the page cannot see (desktop.routeLinks, apps/desktop/src/link-routing.ts).
import { useEffect } from 'react';
import { parsePullRequestUrl, pullRequestPage, type RepoChannel } from '@omni/shared/pr-links.ts';
import { desktop } from './desktop.ts';
import { href, navigate, useRoute } from './router.ts';
import { useApp } from './store.tsx';

let known: { channels: readonly RepoChannel[]; prefer: string | null } = { channels: [], prefer: null };

/** The channels whose repos have PR pages, and the one on screen, which wins when two share a repo. */
export function setKnownChannels(channels: readonly RepoChannel[], prefer: string | null = null) {
  known = { channels, prefer };
}

/** The Omni hash for a PR link, or null when the link should open on GitHub. */
export function pullRequestHref(url: string): string | null {
  const page = pullRequestPage(url, known.channels, known.prefer);
  if (!page) return null;
  const to = href.pr(page.channelId, page.number);
  return location.hash === to ? null : to;
}

// A PR link the page sent to GitHub on purpose. In the desktop app its popup still reaches the main process, which
// asks the page about it (routeLinks): the answer has to be no, not the Omni page.
const SENT_MS = 2000;
let sent: { url: string; at: number } | null = null;

const sendToGitHub = (url: string) => {
  sent = { url, at: Date.now() };
};

function sentToGitHub(url: string): boolean {
  const hit = sent !== null && sent.url === url && Date.now() - sent.at <= SENT_MS;
  if (hit) sent = null;
  return hit;
}

/** Opens a PR link on its Omni page. False when Omni has no page for it, and the link opens on GitHub. */
export function openPullRequestLink(url: string): boolean {
  if (sentToGitHub(url)) return false;
  const to = pullRequestHref(url);
  if (!to) return false;
  navigate(to);
  return true;
}

/** An "Open on GitHub" control that is not a link: opens the PR on GitHub, never its Omni page. */
export function openOnGitHub(url: string) {
  sendToGitHub(url);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** The document's click listener. Runs after React's, so a link whose own handler took the click is left alone. */
export function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(a instanceof HTMLAnchorElement)) return;
  const url = a.href;
  if (!parsePullRequestUrl(url)) return;
  const toGitHub = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.hasAttribute('download') || a.closest('[data-external]') !== null;
  if (!toGitHub) {
    const to = pullRequestHref(url);
    if (to) {
      e.preventDefault();
      navigate(to);
      return;
    }
  }
  sendToGitHub(url);
}

/** Mounted once under the app's provider, in every layout. */
export function usePullRequestLinks() {
  const route = useRoute();
  const { channels, openThread } = useApp();
  const prefer = route.name === 'channel' ? route.id : route.name === 'thread' && openThread?.id === route.id ? openThread.channel_id : null;
  useEffect(() => setKnownChannels(channels, prefer), [channels, prefer]);
  useEffect(() => {
    document.addEventListener('click', onLinkClick);
    const stop = desktop?.routeLinks?.(openPullRequestLink);
    return () => {
      document.removeEventListener('click', onLinkClick);
      stop?.();
    };
  }, []);
}
