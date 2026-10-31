// Which tool a link points into, and what it points at, read from the URL alone. Pure: the server's link
// resolver (apps/server/links.ts) starts from this and fills in the live title; both clients only draw what it sends.
// A link no source claims is a plain web page, whose <title> the resolver may fetch.
import { SOURCES, type LinkRef, type SourceId } from './link-source-types.ts';
import type { Parser } from './link-source-types.ts';
import { github, gitlab, bitbucket, azureDevops, atlassian, linear, trello, asana, clickup, productive, sentry } from './link-parsers-work.ts';
import { notion, figma, google, slack, media, design, shopify, cms, marketing, infra, dev, microsoft, claude } from './link-parsers-content.ts';

export { SOURCES, slugTitle, type LinkRef, type SourceId } from './link-source-types.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const seg = (u: URL) => u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });

const PARSERS: Parser[] = [github, gitlab, bitbucket, azureDevops, atlassian, linear, trello, asana, clickup, productive, sentry, notion, figma, google, slack, media, design, shopify, cms, marketing, infra, dev, microsoft, claude];

/** What a link points at, or null for anything that is not an http(s) URL. */
export function parseLink(href: string): LinkRef | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const p = seg(u);
  for (const parse of PARSERS) {
    const ref = parse(u, host, p);
    if (ref) return ref;
  }
  const bare = host.replace(/^www\./, '');
  return { source: 'web', kind: 'page', fallback: p.length ? `${bare}/${p.join('/')}` : bare, context: bare, params: {}, fetchTitle: true };
}

/** What a client draws for a link: the resolver's answer. */
export interface LinkPreview {
  url: string;
  source: SourceId;
  /** Key of LINK_ICONS. */
  icon: string;
  /** The source's name: "GitHub", "Azure DevOps". */
  name: string;
  kind: string;
  /** Short id drawn before the text, muted: "#7723", "29549". */
  ref?: string;
  /** The text: the fetched title, else what the URL says. */
  text: string;
  /** True when `text` came from the source itself, not from the URL. */
  resolved: boolean;
  context?: string;
  /** open, closed, merged, draft, or the tracker's own state ("Active", "Done"). */
  state?: string;
  /** The secret that would let Omni fetch the title, when it is missing: "AZURE_DEVOPS_PAT". */
  needs?: string;
}

/** The preview for what the URL alone says, before any fetch. */
export function previewOf(url: string, ref: LinkRef, found?: { title?: string; state?: string; context?: string; needs?: string }): LinkPreview {
  const s = SOURCES[ref.source];
  const title = found?.title?.replace(/\s+/g, ' ').trim().slice(0, 200);
  const named = title || ref.title;
  return {
    url,
    source: ref.source,
    icon: s.icon,
    name: s.name,
    kind: ref.kind,
    // With a title the id leads ("#7723 Fix the cart"); without one it reads as words ("Pull request #7723").
    ...(ref.ref && named && { ref: ref.ref }),
    text: named || (ref.ref ? `${ref.fallback} ${ref.ref}` : ref.fallback),
    resolved: !!title,
    ...((found?.context ?? ref.context) && { context: found?.context ?? ref.context }),
    // GitHub's `open` reads as Open; a tracker's own `In Progress` or a version is left as it is.
    ...(found?.state && { state: /^[a-z][a-z_ ]*$/.test(found.state) ? cap(found.state.replace(/_/g, ' ')) : found.state }),
    ...(found?.needs && { needs: found.needs }),
  };
}
