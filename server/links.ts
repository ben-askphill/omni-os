// Link previews: a URL in a reply in, the title its tool gives it out. shared/link-sources.ts reads what the URL
// points at; here each source's API is asked for the live title and state, with the credentials Ben keeps as
// secrets (global, or the channel's own), and a public page that no API answers gives its <title>.
// Every lookup is cached, failures included, so a transcript re-rendering asks nothing twice.
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { parseLink, previewOf, type LinkPreview, type LinkRef } from '../shared/link-sources.ts';
import { artifacts } from './db.ts';
import { secretsEnv } from './secrets.ts';

const run = promisify(execFile);

/** What a resolver may use. Tests pass their own. */
export interface LinkDeps {
  /** A secret by name, channel-scoped first, else global. Never logged. */
  secret(name: string): Promise<string | undefined>;
  /** JSON from a fixed API host. Throws on a non-2xx answer. */
  json(url: string, init?: RequestInit): Promise<any>;
  /** `gh api ...args` as Ben's gh login, parsed. */
  gh(...args: string[]): Promise<any>;
  /** A public page's title, or undefined. */
  pageTitle(url: string): Promise<{ title?: string; site?: string } | undefined>;
  /** The newest artifact published at a claude.ai URL. */
  artifact(url: string): { name: string; description: string | null } | undefined;
}

type Found = { title?: string; state?: string; context?: string; needs?: string } | undefined;
/** Resolvers read the params their own parser set, so each one they use is there. */
type Ref = LinkRef & { params: Record<string, string> };
type Resolver = (ref: Ref, url: string, d: LinkDeps) => Promise<Found>;

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const firstLine = (s: string | undefined) => s?.split('\n')[0]?.trim();
/** The first secret of `names` that is set. */
async function anySecret(d: LinkDeps, ...names: string[]) {
  for (const n of names) {
    const v = await d.secret(n);
    if (v) return v;
  }
  return undefined;
}

// ---------- per source ----------

const github: Resolver = async (ref, _url, d) => {
  const { owner, repo, number, sha, tag, id } = ref.params;
  const r = `repos/${owner}/${repo}`;
  switch (ref.kind) {
    case 'pull':
    case 'issue': {
      const i = await d.gh(`${r}/issues/${number}`);
      const pr = i.pull_request;
      const state = pr?.merged_at ? 'merged' : i.draft ? 'draft' : i.state;
      return { title: i.title, state };
    }
    case 'discussion': {
      const q = `query{repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}){discussion(number:${Number(number)}){title closed}}}`;
      const res = await d.gh('graphql', '-f', `query=${q}`);
      const disc = res?.data?.repository?.discussion;
      return disc ? { title: disc.title, state: disc.closed ? 'closed' : 'open' } : undefined;
    }
    case 'commit':
      return { title: firstLine((await d.gh(`${r}/commits/${sha}`)).commit?.message) };
    case 'release': {
      const rel = await d.gh(`${r}/releases/tags/${encodeURIComponent(tag)}`);
      return { title: rel.name || rel.tag_name, state: rel.draft ? 'draft' : rel.prerelease ? 'prerelease' : undefined };
    }
    case 'run': {
      const w = await d.gh(`${r}/actions/runs/${id}`);
      return { title: w.display_title ?? w.name, state: w.conclusion ?? w.status };
    }
    case 'repo': {
      const info = await d.gh(r);
      return { title: info.full_name, context: firstLine(info.description) };
    }
    case 'gist': {
      const g = await d.gh(`gists/${ref.params.id}`);
      return { title: g.description || Object.keys(g.files ?? {})[0] };
    }
    case 'user': {
      const u = await d.gh(`users/${ref.params.owner}`);
      return { title: u.name ? `${u.name} (${u.login})` : u.login };
    }
  }
};

/** dev.azure.com with a PAT: AZURE_DEVOPS_PAT, global or the channel's. */
const azureDevops: Resolver = async (ref, _url, d) => {
  if (!['work-item', 'pull', 'build', 'commit'].includes(ref.kind)) return;
  const pat = await anySecret(d, 'AZURE_DEVOPS_PAT', 'AZURE_DEVOPS_TOKEN', 'ADO_PAT');
  if (!pat) return { needs: 'AZURE_DEVOPS_PAT' };
  const { org, project, repo, id, sha } = ref.params;
  const base = `https://dev.azure.com/${encodeURIComponent(org)}`;
  const init = { headers: { Authorization: basic('', pat), Accept: 'application/json' } };
  const p = project ? `/${encodeURIComponent(project)}` : '';
  switch (ref.kind) {
    case 'work-item': {
      const w = await d.json(`${base}${p}/_apis/wit/workitems/${id}?fields=System.Title,System.State,System.WorkItemType&api-version=7.1`, init);
      const f = w.fields ?? {};
      return { title: f['System.Title'], state: f['System.State'], context: f['System.WorkItemType'] };
    }
    case 'pull': {
      const pr = await d.json(`${base}${p}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests/${id}?api-version=7.1`, init);
      return { title: pr.title, state: pr.isDraft && pr.status === 'active' ? 'draft' : pr.status === 'completed' ? 'merged' : pr.status };
    }
    case 'build': {
      const b = await d.json(`${base}${p}/_apis/build/builds/${id}?api-version=7.1`, init);
      return { title: `${b.definition?.name ?? 'Build'} ${b.buildNumber ?? ''}`.trim(), state: b.result ?? b.status };
    }
    case 'commit': {
      const c = await d.json(`${base}${p}/_apis/git/repositories/${encodeURIComponent(repo)}/commits/${sha}?api-version=7.1`, init);
      return { title: firstLine(c.comment) };
    }
  }
};

/** Atlassian Cloud with an API token: ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (or the JIRA_ names). */
const atlassian: Resolver = async (ref, _url, d) => {
  if (!(ref.source === 'jira' && ref.kind === 'issue') && !(ref.source === 'confluence' && ref.kind === 'page')) return;
  const email = await anySecret(d, 'ATLASSIAN_EMAIL', 'JIRA_EMAIL', 'CONFLUENCE_EMAIL');
  const token = await anySecret(d, 'ATLASSIAN_API_TOKEN', 'JIRA_API_TOKEN', 'CONFLUENCE_API_TOKEN');
  if (!email || !token) return { needs: 'ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN' };
  const init = { headers: { Authorization: basic(email, token), Accept: 'application/json' } };
  if (ref.source === 'jira') {
    const i = await d.json(`https://${ref.params.site}/rest/api/3/issue/${encodeURIComponent(ref.params.key)}?fields=summary,status,issuetype`, init);
    return { title: i.fields?.summary, state: i.fields?.status?.name, context: i.fields?.issuetype?.name };
  }
  const page = await d.json(`https://${ref.params.site}/wiki/api/v2/pages/${ref.params.id}`, init);
  return { title: page.title };
};

const linear: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'issue') return;
  const key = await anySecret(d, 'LINEAR_API_KEY', 'LINEAR_TOKEN');
  if (!key) return ref.title ? undefined : { needs: 'LINEAR_API_KEY' };
  const res = await d.json('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query($id:String!){issue(id:$id){title state{name}}}', variables: { id: ref.params.id } }),
  });
  const i = res?.data?.issue;
  return i ? { title: i.title, state: i.state?.name } : undefined;
};

const notion: Resolver = async (ref, _url, d) => {
  if (!ref.params.id) return;
  const token = await anySecret(d, 'NOTION_TOKEN', 'NOTION_API_KEY');
  if (!token) return ref.title ? undefined : { needs: 'NOTION_TOKEN' };
  const init = { headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' } };
  const page = await d.json(`https://api.notion.com/v1/pages/${ref.params.id}`, init).catch(() => d.json(`https://api.notion.com/v1/databases/${ref.params.id}`, init));
  const props = Object.values(page.properties ?? {}) as any[];
  const titleProp = props.find((p) => p?.type === 'title')?.title ?? page.title;
  const title = Array.isArray(titleProp) ? titleProp.map((t: any) => t.plain_text).join('') : undefined;
  return { title };
};

const figma: Resolver = async (ref, _url, d) => {
  if (!ref.params.key) return;
  const token = await anySecret(d, 'FIGMA_TOKEN', 'FIGMA_ACCESS_TOKEN', 'FIGMA_API_KEY');
  if (!token) return;
  const f = await d.json(`https://api.figma.com/v1/files/${ref.params.key}?depth=1`, { headers: { 'X-Figma-Token': token } });
  return { title: f.name };
};

/** api.productive.io with PRODUCTIVE_API_KEY; the org id is in the URL. */
const productive: Resolver = async (ref, _url, d) => {
  const { org, id } = ref.params;
  if (!org || !id) return;
  const token = await anySecret(d, 'PRODUCTIVE_API_KEY', 'PRODUCTIVE_API_TOKEN', 'PRODUCTIVE_TOKEN');
  if (!token) return { needs: 'PRODUCTIVE_API_KEY' };
  const path = { task: 'tasks', project: 'projects', deal: 'deals', page: 'pages' }[ref.kind];
  if (!path) return;
  const res = await d.json(`https://api.productive.io/api/v2/${path}/${id}`, {
    headers: { 'X-Auth-Token': token, 'X-Organization-Id': org, 'Content-Type': 'application/vnd.api+json' },
  });
  const a = res?.data?.attributes ?? {};
  const state = ref.kind === 'task' ? (a.closed ? 'closed' : 'open') : a.archived_at ? 'archived' : undefined;
  return { title: a.title ?? a.name, state };
};

const slack: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'message' && ref.kind !== 'channel') return;
  const token = await anySecret(d, 'SLACK_BOT_TOKEN', 'SLACK_USER_TOKEN', 'SLACK_TOKEN');
  if (!token) return { needs: 'SLACK_BOT_TOKEN' };
  const init = { headers: { Authorization: `Bearer ${token}` } };
  const info = await d.json(`https://slack.com/api/conversations.info?channel=${encodeURIComponent(ref.params.channel)}`, init);
  const name = info?.ok && info.channel?.name ? `#${info.channel.name}` : undefined;
  if (ref.kind === 'channel') return { title: name };
  const hist = await d
    .json(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(ref.params.channel)}&latest=${ref.params.ts}&inclusive=true&limit=1`, init)
    .catch(() => undefined);
  const text = hist?.ok ? firstLine(hist.messages?.[0]?.text) : undefined;
  const short = text && text.length > 90 ? `${text.slice(0, 89)}…` : text;
  return { title: short ?? (name ? `Message in ${name}` : undefined), context: name };
};

/** The store's Admin API with SHOPIFY_ACCESS_TOKEN (the channel's store). A token for another store just fails. */
const shopify: Resolver = async (ref, url, d) => {
  const { store, id, type } = ref.params;
  if (store && id && type) {
    const token = await anySecret(d, 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_ADMIN_API_TOKEN');
    if (token) {
      const gid = `gid://shopify/${type}/${id}`;
      const query = `query($id:ID!){node(id:$id){... on Product{title status} ... on Collection{title} ... on Order{name displayFinancialStatus} ... on DraftOrder{name status} ... on Customer{displayName} ... on Page{title} ... on Article{title} ... on Blog{title} ... on OnlineStoreTheme{name role} ... on Menu{title} ... on Location{name} ... on Market{name} ... on Metaobject{displayName}}}`;
      const res = await d.json(`https://${store}.myshopify.com/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id: gid } }),
      });
      const n = res?.data?.node;
      if (n) return { title: n.title ?? n.name ?? n.displayName, state: n.status ?? n.role ?? n.displayFinancialStatus };
    }
    return;
  }
};

const oembed = (endpoint: string): Resolver => async (ref, url, d) => {
  if (ref.kind !== 'video') return;
  const o = await d.json(`${endpoint}${encodeURIComponent(url)}`);
  return { title: o.title, context: o.author_name };
};

const claude: Resolver = async (ref, url, d) => {
  if (ref.kind === 'artifact') {
    const a = d.artifact(url);
    return a ? { title: a.name, context: a.description ?? undefined } : {};
  }
};

const npm: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'package') return;
  const p = await d.json(`https://registry.npmjs.org/${ref.params.name.replace('/', '%2F')}/latest`);
  return { title: ref.params.name, context: p.description, state: p.version ? `v${p.version}` : undefined };
};

const gitlab: Resolver = async (ref, _url, d) => {
  const { host, project, number } = ref.params;
  if (!number || !project) return;
  const token = await anySecret(d, 'GITLAB_TOKEN', 'GITLAB_PRIVATE_TOKEN');
  const kind = ref.kind === 'issue' ? 'issues' : 'merge_requests';
  const r = await d.json(`https://${host}/api/v4/projects/${encodeURIComponent(project)}/${kind}/${number}`, token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined);
  return { title: r.title, state: r.draft ? 'draft' : r.state === 'opened' ? 'open' : r.state };
};

const bitbucket: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'pull') return;
  const { ws, repo, number } = ref.params;
  const r = await d.json(`https://api.bitbucket.org/2.0/repositories/${ws}/${repo}/pullrequests/${number}`);
  return { title: r.title, state: r.state?.toLowerCase() };
};

const sentry: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'issue') return;
  const token = await anySecret(d, 'SENTRY_AUTH_TOKEN', 'SENTRY_TOKEN');
  if (!token) return;
  const i = await d.json(`https://sentry.io/api/0/issues/${ref.params.id}/`, { headers: { Authorization: `Bearer ${token}` } });
  return { title: i.title, state: i.status };
};

const asana: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'task') return;
  const token = await anySecret(d, 'ASANA_TOKEN', 'ASANA_ACCESS_TOKEN');
  if (!token) return;
  const t = await d.json(`https://app.asana.com/api/1.0/tasks/${ref.params.id}?opt_fields=name,completed`, { headers: { Authorization: `Bearer ${token}` } });
  return { title: t.data?.name, state: t.data?.completed ? 'done' : undefined };
};

const clickup: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'task') return;
  const token = await anySecret(d, 'CLICKUP_TOKEN', 'CLICKUP_API_TOKEN');
  if (!token) return;
  const t = await d.json(`https://api.clickup.com/api/v2/task/${ref.params.id}`, { headers: { Authorization: token } });
  return { title: t.name, state: t.status?.status };
};

const trello: Resolver = async (ref, _url, d) => {
  if (ref.kind !== 'card' && ref.kind !== 'board') return;
  const key = await d.secret('TRELLO_KEY');
  const token = await d.secret('TRELLO_TOKEN');
  if (!key || !token) return;
  const r = await d.json(`https://api.trello.com/1/${ref.kind === 'card' ? 'cards' : 'boards'}/${ref.params.id}?fields=name,closed&key=${key}&token=${token}`);
  return { title: r.name, state: r.closed ? 'closed' : undefined };
};

/** A Google Doc, Sheet or Slides deck shared by link names itself; a private one only shows a sign-in page. */
const google: Resolver = async (ref, url, d) => {
  if (!ref.fetchTitle) return {};
  const found = await d.pageTitle(url);
  const title = found?.title?.replace(/\s+-\s+Google (Docs|Sheets|Slides|Forms|Drive)$/, '');
  if (!title || /sign[- ]in|^Google (Docs|Sheets|Slides|Forms|Drive)$|^Meet$/i.test(title)) return {};
  return { title };
};

async function pageFound(url: string, d: LinkDeps): Promise<Found> {
  const found = await d.pageTitle(url);
  return found?.title ? { title: found.title, ...(found.site && { context: found.site }) } : undefined;
}

const RESOLVERS: Partial<Record<LinkRef['source'], Resolver>> = {
  github, 'azure-devops': azureDevops, jira: atlassian, confluence: atlassian, linear, notion, figma, productive, slack,
  shopify, claude, npm, gitlab, bitbucket, sentry, asana, clickup, trello,
  'google-docs': google, 'google-sheets': google, 'google-slides': google, 'google-forms': google, 'google-drive': google,
  loom: oembed('https://www.loom.com/v1/oembed?url='),
  youtube: oembed('https://www.youtube.com/oembed?format=json&url='),
  vimeo: oembed('https://vimeo.com/api/oembed.json?url='),
};

/** One URL's preview. Never throws: a failed lookup leaves what the URL says. */
export async function resolveLink(url: string, d: LinkDeps): Promise<LinkPreview | null> {
  const ref = parseLink(url);
  if (!ref) return null;
  let found: Found;
  try {
    const own = RESOLVERS[ref.source];
    found = own ? await own(ref as Ref, url, d) : undefined;
    // A resolver that had nothing to ask leaves a public page to its <title>; one that asked and got {} does not.
    if (found === undefined && ref.fetchTitle) found = await pageFound(url, d);
  } catch {
    found = undefined;
  }
  return previewOf(url, ref, found);
}

// ---------- the real deps ----------

const PRIVATE_V4 = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xe0000000, 4], [0xf0000000, 4],
] as const;

/** Loopback, private, link-local, CGNAT, multicast and reserved addresses: never fetched. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
    return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7)) || !isIP(v.slice(7));
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
}

async function publicHost(host: string) {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return !isPrivateAddress(bare);
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.local') || bare.endsWith('.internal')) return false;
  const addrs = await lookup(bare, { all: true }).catch(() => []);
  return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Omni/1.0 Safari/537.36';
const PAGE_MAX = 512 * 1024;

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" })[e as 'amp']);

/** og:title, else twitter:title, else <title>, and og:site_name, from the head of a page. */
export function titleFromHtml(html: string): { title?: string; site?: string } {
  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    return tag?.match(/content=["']([^"']*)["']/i)?.[1];
  };
  const raw = meta('og:title') ?? meta('twitter:title') ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = raw ? decodeEntities(raw).replace(/\s+/g, ' ').trim() : undefined;
  const site = meta('og:site_name');
  return { ...(title && { title }), ...(site && { site: decodeEntities(site).trim() }) };
}

/** A public page's head, read with redirects followed by hand so each hop's host is checked. */
async function fetchPageTitle(url: string) {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(at);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !(await publicHost(u.hostname))) return undefined;
    const res = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      at = new URL(res.headers.get('location')!, at).toString();
      // A sign-in wall is not the page's title.
      if (/accounts\.google\.com|login\.microsoftonline\.com|\/login|\/signin/i.test(at)) return undefined;
      continue;
    }
    if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel();
      return undefined;
    }
    const reader = res.body?.getReader();
    if (!reader) return undefined;
    let html = '';
    const dec = new TextDecoder();
    while (html.length < PAGE_MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => {});
    return titleFromHtml(html);
  }
  return undefined;
}

const secretCache = new Map<string, { at: number; env: Promise<Record<string, string>> }>();
/** A channel's secrets (global overridden by its own), read from the Keychain at most once a minute. */
function channelSecrets(channelId: string | undefined) {
  const key = channelId ?? '';
  const hit = secretCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.env;
  const env = secretsEnv(key).catch(() => ({}) as Record<string, string>);
  secretCache.set(key, { at: Date.now(), env });
  return env;
}

export function realDeps(channelId?: string): LinkDeps {
  return {
    secret: async (name) => (await channelSecrets(channelId))[name] || undefined,
    async json(url, init) {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`${new URL(url).host} answered ${res.status}`);
      }
      return res.json();
    },
    async gh(...args) {
      const { stdout } = await run('gh', ['api', ...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
      return JSON.parse(stdout);
    },
    pageTitle: (url) => fetchPageTitle(url).catch(() => undefined),
    artifact: (url) => artifacts.byUrl(url),
  };
}

// ---------- cache ----------

const TTL = 10 * 60_000;
const MAX = 3000;
const cache = new Map<string, { at: number; preview: Promise<LinkPreview | null> }>();

/** Previews for many URLs at once, cached per channel (its secrets can change the answer). */
export async function resolveLinks(urls: string[], channelId?: string, deps: LinkDeps = realDeps(channelId)) {
  const out: Record<string, LinkPreview> = {};
  const queue = [...new Set(urls)];
  const work = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const key = `${channelId ?? ''}\n${url}`;
      let hit = cache.get(key);
      if (!hit || Date.now() - hit.at > TTL) {
        hit = { at: Date.now(), preview: resolveLink(url, deps).catch(() => null) };
        cache.delete(key);
        cache.set(key, hit);
        if (cache.size > MAX) cache.delete(cache.keys().next().value!);
      }
      const p = await hit.preview;
      if (p) out[url] = p;
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, work));
  return out;
}

/** Tests start from an empty cache. */
export function clearLinkCache() {
  cache.clear();
  secretCache.clear();
}
