// Which tool a link points into, and what it points at, read from the URL alone. Pure: the server's link
// resolver (server/links.ts) starts from this and fills in the live title; both clients only draw what it sends.
// A link no source claims is a plain web page, whose <title> the resolver may fetch.

export type SourceId =
  | 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'jira' | 'confluence' | 'trello' | 'linear' | 'asana'
  | 'clickup' | 'notion' | 'figma' | 'miro' | 'canva' | 'framer' | 'webflow' | 'shopify' | 'productive' | 'slack'
  | 'google-docs' | 'google-sheets' | 'google-slides' | 'google-forms' | 'google-drive' | 'google-calendar' | 'gmail'
  | 'google-meet' | 'loom' | 'youtube' | 'vimeo' | 'vercel' | 'netlify' | 'sentry' | 'cloudflare' | 'npm'
  | 'stackoverflow' | 'mdn' | 'claude' | 'prismic' | 'datocms' | 'contentful' | 'sanity' | 'storyblok' | 'hubspot'
  | 'klaviyo' | 'airtable' | 'dropbox' | 'microsoft' | 'supabase' | 'postman' | 'algolia' | 'stripe' | 'openai'
  | 'zendesk' | 'intercom' | 'x' | 'web';

/** Display name and icon (a key of LINK_ICONS in shared/link-icons.ts) per source. */
export const SOURCES: Record<SourceId, { name: string; icon: string }> = {
  github: { name: 'GitHub', icon: 'github' },
  gitlab: { name: 'GitLab', icon: 'gitlab' },
  bitbucket: { name: 'Bitbucket', icon: 'bitbucket' },
  'azure-devops': { name: 'Azure DevOps', icon: 'microsoft' },
  jira: { name: 'Jira', icon: 'jira' },
  confluence: { name: 'Confluence', icon: 'confluence' },
  trello: { name: 'Trello', icon: 'trello' },
  linear: { name: 'Linear', icon: 'linear' },
  asana: { name: 'Asana', icon: 'asana' },
  clickup: { name: 'ClickUp', icon: 'clickup' },
  notion: { name: 'Notion', icon: 'notion' },
  figma: { name: 'Figma', icon: 'figma' },
  miro: { name: 'Miro', icon: 'miro' },
  canva: { name: 'Canva', icon: 'canva' },
  framer: { name: 'Framer', icon: 'framer' },
  webflow: { name: 'Webflow', icon: 'webflow' },
  shopify: { name: 'Shopify', icon: 'shopify' },
  productive: { name: 'Productive', icon: 'link' },
  slack: { name: 'Slack', icon: 'slack' },
  'google-docs': { name: 'Google Docs', icon: 'google-docs' },
  'google-sheets': { name: 'Google Sheets', icon: 'google-sheets' },
  'google-slides': { name: 'Google Slides', icon: 'google-slides' },
  'google-forms': { name: 'Google Forms', icon: 'google' },
  'google-drive': { name: 'Google Drive', icon: 'google-drive' },
  'google-calendar': { name: 'Google Calendar', icon: 'google-calendar' },
  gmail: { name: 'Gmail', icon: 'gmail' },
  'google-meet': { name: 'Google Meet', icon: 'google' },
  loom: { name: 'Loom', icon: 'loom' },
  youtube: { name: 'YouTube', icon: 'youtube' },
  vimeo: { name: 'Vimeo', icon: 'vimeo' },
  vercel: { name: 'Vercel', icon: 'vercel' },
  netlify: { name: 'Netlify', icon: 'netlify' },
  sentry: { name: 'Sentry', icon: 'sentry' },
  cloudflare: { name: 'Cloudflare', icon: 'cloudflare' },
  npm: { name: 'npm', icon: 'npm' },
  stackoverflow: { name: 'Stack Overflow', icon: 'stackoverflow' },
  mdn: { name: 'MDN', icon: 'mdn' },
  claude: { name: 'Claude', icon: 'claude' },
  prismic: { name: 'Prismic', icon: 'prismic' },
  datocms: { name: 'DatoCMS', icon: 'datocms' },
  contentful: { name: 'Contentful', icon: 'contentful' },
  sanity: { name: 'Sanity', icon: 'sanity' },
  storyblok: { name: 'Storyblok', icon: 'storyblok' },
  hubspot: { name: 'HubSpot', icon: 'hubspot' },
  klaviyo: { name: 'Klaviyo', icon: 'link' },
  airtable: { name: 'Airtable', icon: 'airtable' },
  dropbox: { name: 'Dropbox', icon: 'dropbox' },
  microsoft: { name: 'Microsoft', icon: 'microsoft' },
  supabase: { name: 'Supabase', icon: 'supabase' },
  postman: { name: 'Postman', icon: 'postman' },
  algolia: { name: 'Algolia', icon: 'algolia' },
  stripe: { name: 'Stripe', icon: 'stripe' },
  openai: { name: 'OpenAI', icon: 'openai' },
  zendesk: { name: 'Zendesk', icon: 'zendesk' },
  intercom: { name: 'Intercom', icon: 'intercom' },
  x: { name: 'X', icon: 'x' },
  web: { name: 'Web', icon: 'link' },
};

/** What a URL points at, before anything is fetched. */
export interface LinkRef {
  source: SourceId;
  /** What kind of thing: 'pull', 'issue', 'work-item', 'page', 'file'... Resolvers switch on it. */
  kind: string;
  /** A short id shown before the title: `#7723`, `29549`, `KE-12`, `a1b2c3d`. */
  ref?: string;
  /** A title the URL itself carries (a Notion or Confluence slug), used until a better one is fetched. */
  title?: string;
  /** Text to show when no title is found: "Work item", "Product 123". */
  fallback: string;
  /** Where it lives: `owner/repo`, the org, the store. */
  context?: string;
  /** Values a resolver needs: owner, repo, org, project, ids. */
  params: Partial<Record<string, string>>;
  /** The page is public, so its <title> is worth fetching when no API answers. */
  fetchTitle?: boolean;
}

/** `Volero-Design-System` or `fix+the+cart` as words; null when nothing word-like is left. */
export function slugTitle(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  let s: string;
  try {
    s = decodeURIComponent(slug.replace(/\+/g, ' '));
  } catch {
    s = slug;
  }
  s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/[a-z]/i.test(s)) return undefined;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const seg = (u: URL) => u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });

type Parser = (u: URL, host: string, p: string[]) => LinkRef | null | undefined;

// ---------- code hosts ----------

const github: Parser = (u, host, p) => {
  if (host === 'gist.github.com' && p.length >= 2) {
    return { source: 'github', kind: 'gist', fallback: 'Gist', context: p[0], params: { id: p[1] } };
  }
  if (host !== 'github.com' && host !== 'www.github.com') return;
  const [owner, repo, kind, ...rest] = p;
  const RESERVED = ['settings', 'notifications', 'login', 'marketplace', 'explore', 'topics', 'search', 'pulls', 'issues', 'features', 'about', 'pricing', 'sponsors', 'orgs', 'apps', 'enterprise', 'new', 'codespaces'];
  if (!owner || RESERVED.includes(owner)) return { source: 'github', kind: 'page', fallback: 'GitHub', params: {}, fetchTitle: true };
  if (!repo) return { source: 'github', kind: 'user', fallback: owner, params: { owner } };
  const context = `${owner}/${repo}`;
  const params = { owner, repo };
  const n = rest[0];
  if ((kind === 'pull' || kind === 'issues') && n && /^\d+$/.test(n)) {
    return { source: 'github', kind: kind === 'pull' ? 'pull' : 'issue', ref: `#${n}`, fallback: kind === 'pull' ? 'Pull request' : 'Issue', context, params: { ...params, number: n } };
  }
  if (kind === 'discussions' && n && /^\d+$/.test(n)) {
    return { source: 'github', kind: 'discussion', ref: `#${n}`, fallback: 'Discussion', context, params: { ...params, number: n } };
  }
  if (kind === 'commit' && n && /^[0-9a-f]{7,40}$/i.test(n)) {
    return { source: 'github', kind: 'commit', ref: n.slice(0, 7), fallback: 'Commit', context, params: { ...params, sha: n } };
  }
  if (kind === 'pull' && rest[1] === 'commits' && rest[2]) {
    return { source: 'github', kind: 'commit', ref: rest[2].slice(0, 7), fallback: 'Commit', context, params: { ...params, sha: rest[2] } };
  }
  if (kind === 'releases' && rest[0] === 'tag' && rest[1]) {
    return { source: 'github', kind: 'release', ref: rest[1], fallback: 'Release', context, params: { ...params, tag: rest[1] } };
  }
  if (kind === 'actions' && rest[0] === 'runs' && rest[1] && /^\d+$/.test(rest[1])) {
    return { source: 'github', kind: 'run', fallback: 'Workflow run', context, params: { ...params, id: rest[1] } };
  }
  if ((kind === 'blob' || kind === 'tree') && rest.length >= 1) {
    const path = rest.slice(1).join('/');
    const line = u.hash.match(/^#L(\d+)/)?.[1];
    return { source: 'github', kind: 'file', title: path ? `${path}${line ? `:${line}` : ''}` : rest[0], fallback: path || rest[0], context: `${context}@${rest[0]}`, params };
  }
  if (kind === 'compare' && n) return { source: 'github', kind: 'compare', title: n, fallback: 'Compare', context, params };
  if (!kind) return { source: 'github', kind: 'repo', title: context, fallback: context, params };
  return { source: 'github', kind: 'page', title: `${context} ${kind}`, fallback: context, params };
};

const gitlab: Parser = (_u, host, p) => {
  if (host !== 'gitlab.com' && !host.startsWith('gitlab.')) return;
  const dash = p.indexOf('-');
  if (dash < 2) return p.length >= 2 ? { source: 'gitlab', kind: 'repo', title: p.join('/'), fallback: p.join('/'), params: { host } } : undefined;
  const project = p.slice(0, dash).join('/');
  const [kind, n] = p.slice(dash + 1);
  if ((kind === 'issues' || kind === 'merge_requests') && n && /^\d+$/.test(n)) {
    return {
      source: 'gitlab', kind: kind === 'issues' ? 'issue' : 'merge-request', ref: kind === 'issues' ? `#${n}` : `!${n}`,
      fallback: kind === 'issues' ? 'Issue' : 'Merge request', context: project, params: { host, project, number: n },
    };
  }
  if (kind === 'commit' && n) return { source: 'gitlab', kind: 'commit', ref: n.slice(0, 7), fallback: 'Commit', context: project, params: { host, project } };
  return { source: 'gitlab', kind: 'page', fallback: project, context: project, params: { host } };
};

const bitbucket: Parser = (_u, host, p) => {
  if (host !== 'bitbucket.org') return;
  const [ws, repo, kind, n] = p;
  if (!ws || !repo) return { source: 'bitbucket', kind: 'page', fallback: 'Bitbucket', params: {} };
  const context = `${ws}/${repo}`;
  if (kind === 'pull-requests' && n && /^\d+$/.test(n)) {
    return { source: 'bitbucket', kind: 'pull', ref: `#${n}`, fallback: 'Pull request', context, params: { ws, repo, number: n } };
  }
  if (kind === 'commits' && n) return { source: 'bitbucket', kind: 'commit', ref: n.slice(0, 7), fallback: 'Commit', context, params: {} };
  return { source: 'bitbucket', kind: 'repo', title: context, fallback: context, params: {} };
};

// ---------- trackers ----------

/** dev.azure.com/{org}/{project}/... and the older {org}.visualstudio.com/{project}/... */
const azureDevops: Parser = (u, host, p) => {
  let org: string | undefined;
  let rest: string[];
  if (host === 'dev.azure.com') [org, ...rest] = p;
  else if (host.endsWith('.visualstudio.com')) {
    org = host.slice(0, -'.visualstudio.com'.length);
    rest = p.filter((x) => x !== 'DefaultCollection');
  } else return;
  if (!org) return { source: 'azure-devops', kind: 'page', fallback: 'Azure DevOps', params: {} };
  const base = { source: 'azure-devops' as const, params: { org } };
  const wi = rest.indexOf('_workitems');
  if (wi >= 0) {
    const id = (rest[wi + 1] === 'edit' ? rest[wi + 2] : undefined) ?? u.searchParams.get('workitem') ?? u.searchParams.get('id') ?? undefined;
    const project = wi > 0 ? rest[0] : undefined;
    if (id && /^\d+$/.test(id)) return { ...base, kind: 'work-item', ref: id, fallback: 'Work item', context: project ?? org, params: { org, id, ...(project && { project }) } };
  }
  const workitem = u.searchParams.get('workitem');
  if (workitem && /^\d+$/.test(workitem)) {
    return { ...base, kind: 'work-item', ref: workitem, fallback: 'Work item', context: rest[0] ?? org, params: { org, id: workitem, ...(rest[0] && { project: rest[0] }) } };
  }
  const git = rest.indexOf('_git');
  if (git >= 1) {
    const project = rest[0];
    const repo = rest[git + 1];
    const pr = rest[git + 2] === 'pullrequest' ? rest[git + 3] : undefined;
    if (repo && pr && /^\d+$/.test(pr)) {
      return { ...base, kind: 'pull', ref: `!${pr}`, fallback: 'Pull request', context: repo, params: { org, project, repo, id: pr } };
    }
    if (repo && rest[git + 2] === 'commit' && rest[git + 3]) {
      return { ...base, kind: 'commit', ref: rest[git + 3].slice(0, 7), fallback: 'Commit', context: repo, params: { org, project, repo, sha: rest[git + 3] } };
    }
    if (repo) {
      const path = u.searchParams.get('path');
      return { ...base, kind: 'repo', title: path ? `${repo}${path}` : repo, fallback: repo, context: project, params: { org, project, repo } };
    }
  }
  const build = u.searchParams.get('buildId');
  if (rest.includes('_build') && build && /^\d+$/.test(build)) {
    return { ...base, kind: 'build', ref: build, fallback: 'Build', context: rest[0], params: { org, project: rest[0], id: build } };
  }
  const wiki = rest.indexOf('_wiki');
  if (wiki >= 0) {
    const last = rest[rest.length - 1];
    return { ...base, kind: 'wiki', title: slugTitle(last !== 'wikis' ? last : undefined), fallback: 'Wiki page', context: rest[0], params: { org } };
  }
  const board = rest.find((x) => x === '_boards' || x === '_backlogs' || x === '_sprints');
  if (board) return { ...base, kind: 'board', fallback: 'Board', context: rest[0] ?? org, params: { org } };
  return { ...base, kind: 'page', fallback: rest[0] ?? org, context: org, params: { org } };
};

const atlassian: Parser = (u, host, p) => {
  if (!host.endsWith('.atlassian.net') && !host.endsWith('.jira.com')) return;
  const site = host;
  if (p[0] === 'wiki') {
    const pages = p.indexOf('pages');
    const id = pages >= 0 ? p[pages + 1] : u.searchParams.get('pageId') ?? undefined;
    const space = p[1] === 'spaces' ? p[2] : undefined;
    if (id && /^\d+$/.test(id)) {
      return { source: 'confluence', kind: 'page', title: slugTitle(p[pages + 2]), fallback: 'Page', context: space, params: { site, id } };
    }
    return { source: 'confluence', kind: 'space', fallback: space ? `Space ${space}` : 'Confluence', params: { site } };
  }
  const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
  const key = (p[0] === 'browse' && KEY.test(p[1] ?? '') ? p[1] : undefined)
    ?? (u.searchParams.get('selectedIssue') && KEY.test(u.searchParams.get('selectedIssue')!) ? u.searchParams.get('selectedIssue')! : undefined)
    ?? p.find((x) => KEY.test(x));
  if (key) return { source: 'jira', kind: 'issue', ref: key, fallback: 'Issue', context: site.split('.')[0], params: { site, key } };
  const project = p[0] === 'jira' && p.includes('projects') ? p[p.indexOf('projects') + 1] : undefined;
  return { source: 'jira', kind: 'board', fallback: project ? `Project ${project}` : 'Jira', context: site.split('.')[0], params: { site } };
};

const linear: Parser = (_u, host, p) => {
  if (host !== 'linear.app') return;
  const [ws, kind, id, slug] = p;
  if (kind === 'issue' && id) return { source: 'linear', kind: 'issue', ref: id.toUpperCase(), title: slugTitle(slug), fallback: 'Issue', context: ws, params: { id } };
  if (kind === 'project' && id) {
    const words = id.replace(/-[0-9a-f]{8,}$/i, '');
    return { source: 'linear', kind: 'project', title: slugTitle(words), fallback: 'Project', context: ws, params: {} };
  }
  return { source: 'linear', kind: 'page', fallback: ws ?? 'Linear', params: {} };
};

const trello: Parser = (_u, host, p) => {
  if (host !== 'trello.com') return;
  const [kind, id, slug] = p;
  if (kind === 'c' && id) return { source: 'trello', kind: 'card', title: slugTitle(slug?.replace(/^\d+-/, '')), fallback: 'Card', params: { id } };
  if (kind === 'b' && id) return { source: 'trello', kind: 'board', title: slugTitle(slug), fallback: 'Board', params: { id } };
  return { source: 'trello', kind: 'page', fallback: 'Trello', params: {} };
};

const asana: Parser = (_u, host, p) => {
  if (host !== 'app.asana.com') return;
  // /0/{project}/{task}[/f] and the newer /1/{workspace}/project/{project}/task/{task}
  const task = p[0] === '0' ? p[2] : p[p.indexOf('task') + 1];
  if (task && /^\d+$/.test(task) && task !== '0') return { source: 'asana', kind: 'task', fallback: 'Task', params: { id: task } };
  return { source: 'asana', kind: 'page', fallback: 'Asana', params: {} };
};

const clickup: Parser = (_u, host, p) => {
  if (host !== 'app.clickup.com' && host !== 'sharing.clickup.com') return;
  const t = p.indexOf('t');
  const id = t >= 0 ? p[p.length - 1] : undefined;
  if (id && t < p.length - 1) return { source: 'clickup', kind: 'task', ref: id, fallback: 'Task', params: { id } };
  return { source: 'clickup', kind: 'page', fallback: 'ClickUp', params: {} };
};

/** app.productive.io/{orgId}-{slug}/... : tasks, projects, deals, docs. */
const productive: Parser = (_u, host, p) => {
  if (host !== 'app.productive.io') return;
  const org = p[0]?.match(/^(\d+)-/)?.[1];
  const after = (word: string) => {
    const i = p.lastIndexOf(word);
    return i >= 0 && /^\d+$/.test(p[i + 1] ?? '') ? p[i + 1] : undefined;
  };
  const params = org ? { org } : {};
  const task = after('task') ?? after('tasks');
  if (task) return { source: 'productive', kind: 'task', fallback: `Task ${task}`, params: { ...params, id: task } };
  const project = after('projects');
  if (project) return { source: 'productive', kind: 'project', fallback: `Project ${project}`, params: { ...params, id: project } };
  const deal = after('deals') ?? after('budgets');
  if (deal) return { source: 'productive', kind: 'deal', fallback: `Budget ${deal}`, params: { ...params, id: deal } };
  const doc = after('docs') ?? after('pages');
  if (doc) return { source: 'productive', kind: 'page', fallback: `Doc ${doc}`, params: { ...params, id: doc } };
  return { source: 'productive', kind: 'page', fallback: 'Productive', params };
};

const sentry: Parser = (_u, host, p) => {
  if (host !== 'sentry.io' && !host.endsWith('.sentry.io')) return;
  const i = p.indexOf('issues');
  const id = i >= 0 ? p[i + 1] : undefined;
  if (id && /^\d+$/.test(id)) return { source: 'sentry', kind: 'issue', ref: id, fallback: 'Issue', params: { id } };
  return { source: 'sentry', kind: 'page', fallback: 'Sentry', params: {} };
};

// ---------- docs, design, chat ----------

const notion: Parser = (_u, host, p) => {
  if (host !== 'notion.so' && host !== 'www.notion.so' && !host.endsWith('.notion.site')) return;
  const last = p[p.length - 1] ?? '';
  const m = last.match(/^(?:(.*)-)?([0-9a-f]{32})$/i);
  if (!m) return { source: 'notion', kind: 'page', fallback: 'Notion', params: {} };
  const id = m[2].toLowerCase();
  return { source: 'notion', kind: 'page', title: slugTitle(m[1]), fallback: 'Page', params: { id } };
};

const figma: Parser = (_u, host, p) => {
  if (host !== 'figma.com' && host !== 'www.figma.com') return;
  const [kind, key, name] = p;
  const kinds: Record<string, string> = { file: 'File', design: 'Design', proto: 'Prototype', board: 'FigJam board', slides: 'Slides', make: 'Make', deck: 'Slides' };
  if (key && kinds[kind]) {
    // A branch link is /design/{file}/branch/{branch}/{name}.
    const branch = name === 'branch';
    return { source: 'figma', kind: 'file', title: slugTitle(branch ? p[4] : name), fallback: kinds[kind], params: { key: branch ? p[3] : key } };
  }
  return { source: 'figma', kind: 'page', fallback: 'Figma', params: {}, fetchTitle: true };
};

const google: Parser = (u, host, p) => {
  if (host === 'docs.google.com') {
    const types: Record<string, [SourceId, string]> = {
      document: ['google-docs', 'Google Doc'], spreadsheets: ['google-sheets', 'Google Sheet'],
      presentation: ['google-slides', 'Google Slides'], forms: ['google-forms', 'Google Form'],
    };
    const t = types[p[0]];
    if (t) {
      const d = p.indexOf('d');
      return { source: t[0], kind: p[0], fallback: t[1], params: { id: p[d + 1] === 'e' ? p[d + 2] : p[d + 1] }, fetchTitle: true };
    }
  }
  if (host === 'drive.google.com') {
    if (p[0] === 'file') return { source: 'google-drive', kind: 'file', fallback: 'Drive file', params: { id: p[2] }, fetchTitle: true };
    if (p.includes('folders')) return { source: 'google-drive', kind: 'folder', fallback: 'Drive folder', params: {} };
    return { source: 'google-drive', kind: 'page', fallback: 'Google Drive', params: {} };
  }
  if (host === 'calendar.google.com') return { source: 'google-calendar', kind: 'event', fallback: p.includes('event') || u.searchParams.has('eid') ? 'Calendar event' : 'Google Calendar', params: {} };
  if (host === 'mail.google.com') return { source: 'gmail', kind: 'mail', fallback: 'Gmail', params: {} };
  if (host === 'meet.google.com') return { source: 'google-meet', kind: 'meeting', ref: p[0], fallback: 'Meeting', params: {} };
};

const slack: Parser = (_u, host, p) => {
  if (!host.endsWith('.slack.com') && host !== 'slack.com' && host !== 'app.slack.com') return;
  const workspace = host.endsWith('.slack.com') ? host.split('.')[0] : undefined;
  // {ws}.slack.com/archives/{channel}/p{ts} and app.slack.com/client/{team}/{channel}
  const a = p.indexOf('archives');
  const channel = a >= 0 ? p[a + 1] : p[0] === 'client' ? p[2] : undefined;
  const ts = a >= 0 ? p[a + 2]?.match(/^p(\d{10})(\d{6})$/) : null;
  if (channel && ts) return { source: 'slack', kind: 'message', fallback: 'Slack message', context: workspace, params: { channel, ts: `${ts[1]}.${ts[2]}` } };
  if (channel) return { source: 'slack', kind: 'channel', fallback: 'Slack channel', context: workspace, params: { channel } };
  return { source: 'slack', kind: 'page', fallback: 'Slack', context: workspace, params: {} };
};

const media: Parser = (u, host, p) => {
  if (host === 'loom.com' || host === 'www.loom.com') {
    if ((p[0] === 'share' || p[0] === 'embed') && p[1]) return { source: 'loom', kind: 'video', fallback: 'Loom video', params: {} };
    return { source: 'loom', kind: 'page', fallback: 'Loom', params: {} };
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(host)) {
    const video = host === 'youtu.be' || u.searchParams.has('v') || p[0] === 'shorts' || p[0] === 'live';
    return { source: 'youtube', kind: video ? 'video' : 'page', fallback: video ? 'YouTube video' : 'YouTube', params: {}, fetchTitle: !video };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') return { source: 'vimeo', kind: 'video', fallback: 'Vimeo video', params: {} };
};

const design: Parser = (_u, host, p) => {
  if (host === 'miro.com') {
    return p[0] === 'app' && p[1] === 'board'
      ? { source: 'miro', kind: 'board', fallback: 'Miro board', params: {} }
      : { source: 'miro', kind: 'page', fallback: 'Miro', params: {}, fetchTitle: true };
  }
  if (host === 'canva.com' || host === 'www.canva.com') {
    return p[0] === 'design' ? { source: 'canva', kind: 'design', fallback: 'Canva design', params: {} } : { source: 'canva', kind: 'page', fallback: 'Canva', params: {}, fetchTitle: true };
  }
  if (host === 'framer.com' || host.endsWith('.framer.com') || host.endsWith('.framer.app') || host.endsWith('.framer.website')) {
    return { source: 'framer', kind: p[0] === 'projects' ? 'project' : 'page', fallback: p[0] === 'projects' ? 'Framer project' : host, params: {}, fetchTitle: p[0] !== 'projects' };
  }
  if (host === 'webflow.com' || host.endsWith('.webflow.com') || host.endsWith('.webflow.io')) {
    return { source: 'webflow', kind: 'page', fallback: host, params: {}, fetchTitle: true };
  }
};

/** The admin's path after the store, as words: products/123 is Product 123. */
function shopifyAdmin(store: string, rest: string[]): LinkRef {
  const KINDS: Record<string, [string, string]> = {
    products: ['product', 'Product'], orders: ['order', 'Order'], draft_orders: ['draft-order', 'Draft order'],
    collections: ['collection', 'Collection'], customers: ['customer', 'Customer'], pages: ['page', 'Page'],
    articles: ['article', 'Article'], blogs: ['blog', 'Blog'], discounts: ['discount', 'Discount'],
    themes: ['theme', 'Theme'], menus: ['menu', 'Menu'], metaobjects: ['metaobject', 'Metaobject'],
    files: ['file', 'Files'], markets: ['market', 'Market'], locations: ['location', 'Location'],
  };
  const params = { store };
  if (rest[0] === 'content' && rest[1]) rest = rest.slice(1);
  if (rest[0] === 'apps' && rest[1]) return { source: 'shopify', kind: 'app', title: slugTitle(rest[1]), fallback: 'App', context: store, params };
  if (rest[0] === 'settings') return { source: 'shopify', kind: 'settings', title: rest[1] ? `Settings: ${slugTitle(rest[1])}` : 'Settings', fallback: 'Settings', context: store, params };
  if (rest[0] === 'metaobjects' && rest[1] === 'entries' && rest[2]) {
    const id = rest[3];
    return { source: 'shopify', kind: 'metaobject', ref: id, fallback: id ? `${slugTitle(rest[2])} entry` : `${slugTitle(rest[2])} entries`, context: store, params: { ...params, ...(id && { id, type: 'Metaobject' }) } };
  }
  const k = KINDS[rest[0]];
  if (k) {
    const id = rest.find((x, i) => i > 0 && /^\d+$/.test(x));
    if (rest[0] === 'themes' && id && rest.includes('editor')) {
      return { source: 'shopify', kind: 'theme-editor', ref: id, fallback: 'Theme editor', context: store, params: { ...params, id, type: 'OnlineStoreTheme' } };
    }
    const type = { product: 'Product', order: 'Order', 'draft-order': 'DraftOrder', collection: 'Collection', customer: 'Customer', page: 'Page', article: 'Article', blog: 'Blog', theme: 'OnlineStoreTheme', menu: 'Menu', location: 'Location', market: 'Market' }[k[0]];
    if (id) return { source: 'shopify', kind: k[0], ref: id, fallback: k[1], context: store, params: { ...params, id, ...(type && { type }) } };
    return { source: 'shopify', kind: `${k[0]}-list`, fallback: rest[0] === 'files' ? 'Files' : `${k[1]}s`, context: store, params };
  }
  return { source: 'shopify', kind: 'admin', fallback: rest[0] ? `Admin: ${slugTitle(rest[0])}` : 'Admin', context: store, params };
}

const shopify: Parser = (u, host, p) => {
  if (host === 'admin.shopify.com' && p[0] === 'store' && p[1]) return shopifyAdmin(p[1], p.slice(2));
  if (host.endsWith('.myshopify.com')) {
    const store = host.slice(0, -'.myshopify.com'.length);
    if (p[0] === 'admin') return shopifyAdmin(store, p.slice(1));
    const theme = u.searchParams.get('preview_theme_id');
    if (theme && /^\d+$/.test(theme)) return { source: 'shopify', kind: 'preview', ref: theme, fallback: 'Theme preview', context: store, params: { store, id: theme, type: 'OnlineStoreTheme' } };
    return { source: 'shopify', kind: 'storefront', fallback: store, context: store, params: { store }, fetchTitle: true };
  }
  if (host === 'partners.shopify.com') return { source: 'shopify', kind: 'partners', fallback: 'Partners', params: {} };
  if (['shopify.dev', 'help.shopify.com', 'community.shopify.com', 'apps.shopify.com', 'themes.shopify.com', 'shopify.com', 'www.shopify.com', 'changelog.shopify.com', 'shopify.engineering'].includes(host)) {
    return { source: 'shopify', kind: 'page', fallback: host, params: {}, fetchTitle: true };
  }
};

const cms: Parser = (_u, host, p) => {
  if (host.endsWith('.prismic.io')) {
    const repo = host.split('.')[0];
    const id = p[p.indexOf('pages') + 1] ?? p[p.indexOf('documents') + 1];
    return { source: 'prismic', kind: id ? 'document' : 'page', fallback: id ? 'Prismic document' : 'Prismic', context: repo, params: {} };
  }
  if (host === 'prismic.io') return { source: 'prismic', kind: 'page', fallback: 'Prismic', params: {}, fetchTitle: true };
  if (host.endsWith('.admin.datocms.com')) {
    const project = host.split('.')[0];
    const items = p.indexOf('items');
    return { source: 'datocms', kind: items >= 0 ? 'record' : 'page', ref: items >= 0 ? p[items + 1] : undefined, fallback: items >= 0 ? 'Record' : 'DatoCMS', context: project, params: {} };
  }
  if (host === 'datocms.com' || host === 'www.datocms.com') return { source: 'datocms', kind: 'page', fallback: 'DatoCMS', params: {}, fetchTitle: true };
  if (host === 'app.contentful.com' || host === 'www.contentful.com') {
    const entry = p[p.indexOf('entries') + 1];
    return { source: 'contentful', kind: 'entry', fallback: p.includes('entries') && entry ? 'Entry' : 'Contentful', params: {} };
  }
  if (host.endsWith('.sanity.studio') || host === 'www.sanity.io' || host === 'sanity.io') return { source: 'sanity', kind: 'page', fallback: 'Sanity', params: {}, fetchTitle: host.endsWith('sanity.io') };
  if (host === 'app.storyblok.com' || host.endsWith('storyblok.com')) return { source: 'storyblok', kind: 'page', fallback: 'Storyblok', params: {}, fetchTitle: host !== 'app.storyblok.com' };
};

const marketing: Parser = (_u, host, p) => {
  if (host === 'app.hubspot.com' || host.endsWith('.hubspot.com')) {
    const record = p.indexOf('record');
    return { source: 'hubspot', kind: record >= 0 ? 'record' : 'page', fallback: record >= 0 ? 'HubSpot record' : 'HubSpot', params: {}, fetchTitle: host !== 'app.hubspot.com' };
  }
  if (host === 'www.klaviyo.com' || host === 'klaviyo.com' || host === 'help.klaviyo.com' || host === 'developers.klaviyo.com') {
    const kinds: Record<string, string> = { flow: 'Flow', campaign: 'Campaign', campaigns: 'Campaigns', flows: 'Flows', list: 'List', segment: 'Segment', template: 'Template', profile: 'Profile' };
    const k = p.find((x) => kinds[x]);
    return { source: 'klaviyo', kind: k ?? 'page', fallback: k ? kinds[k] : 'Klaviyo', params: {}, fetchTitle: host !== 'www.klaviyo.com' && host !== 'klaviyo.com' };
  }
  if (host === 'dashboard.stripe.com') return { source: 'stripe', kind: 'dashboard', fallback: p.length ? `Dashboard: ${slugTitle(p.filter((x) => x !== 'test')[0])}` : 'Dashboard', params: {} };
  if (host === 'stripe.com' || host === 'docs.stripe.com') return { source: 'stripe', kind: 'page', fallback: host, params: {}, fetchTitle: true };
  if (host.endsWith('.algolia.com')) return { source: 'algolia', kind: 'page', fallback: 'Algolia', params: {}, fetchTitle: host !== 'dashboard.algolia.com' };
  if (host.endsWith('.zendesk.com')) {
    const t = p.indexOf('tickets');
    return { source: 'zendesk', kind: t >= 0 ? 'ticket' : 'page', ref: t >= 0 && p[t + 1] ? `#${p[t + 1]}` : undefined, fallback: t >= 0 ? 'Ticket' : 'Zendesk', params: {}, fetchTitle: p[0] === 'hc' };
  }
  if (host === 'app.intercom.com' || host === 'www.intercom.com') return { source: 'intercom', kind: 'page', fallback: 'Intercom', params: {} };
};

const infra: Parser = (_u, host, p) => {
  if (host === 'vercel.com') {
    if (p[0] === 'docs' || p[0] === 'blog' || p[0] === 'changelog' || p[0] === 'templates') return { source: 'vercel', kind: 'page', fallback: 'Vercel', params: {}, fetchTitle: true };
    if (p.length >= 3) return { source: 'vercel', kind: 'deployment', fallback: 'Deployment', context: p[1], params: {} };
    if (p.length === 2) return { source: 'vercel', kind: 'project', title: p[1], fallback: p[1], context: p[0], params: {} };
    return { source: 'vercel', kind: 'page', fallback: p[0] ?? 'Vercel', params: {} };
  }
  if (host.endsWith('.vercel.app')) return { source: 'vercel', kind: 'site', fallback: host, params: {}, fetchTitle: true };
  if (host === 'app.netlify.com') return { source: 'netlify', kind: 'site', fallback: p[1] ?? 'Netlify', params: {} };
  if (host.endsWith('.netlify.app') || host === 'docs.netlify.com') return { source: 'netlify', kind: 'site', fallback: host, params: {}, fetchTitle: true };
  if (host === 'dash.cloudflare.com') return { source: 'cloudflare', kind: 'dashboard', fallback: 'Dashboard', params: {} };
  if (host === 'developers.cloudflare.com' || host === 'blog.cloudflare.com') return { source: 'cloudflare', kind: 'page', fallback: host, params: {}, fetchTitle: true };
  if (host === 'supabase.com') {
    return p[0] === 'dashboard' ? { source: 'supabase', kind: 'dashboard', fallback: 'Dashboard', params: {} } : { source: 'supabase', kind: 'page', fallback: 'Supabase', params: {}, fetchTitle: true };
  }
  if (host.endsWith('.postman.com') || host === 'postman.com') return { source: 'postman', kind: 'page', fallback: 'Postman', params: {}, fetchTitle: true };
  if (host === 'airtable.com') return { source: 'airtable', kind: 'base', fallback: 'Airtable base', params: {} };
  if (host === 'dropbox.com' || host === 'www.dropbox.com') {
    const name = p.length ? p[p.length - 1] : undefined;
    return { source: 'dropbox', kind: 'file', title: name && /\.\w{2,5}$/.test(name) ? name : undefined, fallback: 'Dropbox', params: {} };
  }
};

const dev: Parser = (_u, host, p) => {
  if (host === 'npmjs.com' || host === 'www.npmjs.com') {
    if (p[0] === 'package' && p[1]) {
      const name = p[1].startsWith('@') && p[2] ? `${p[1]}/${p[2]}` : p[1];
      return { source: 'npm', kind: 'package', title: name, fallback: name, params: { name } };
    }
    return { source: 'npm', kind: 'page', fallback: 'npm', params: {} };
  }
  if (host === 'stackoverflow.com' || host.endsWith('.stackexchange.com')) {
    if (p[0] === 'questions' && /^\d+$/.test(p[1] ?? '')) return { source: 'stackoverflow', kind: 'question', title: slugTitle(p[2]), fallback: 'Question', params: { id: p[1] }, fetchTitle: !p[2] };
    return { source: 'stackoverflow', kind: 'page', fallback: 'Stack Overflow', params: {}, fetchTitle: true };
  }
  if (host === 'developer.mozilla.org') return { source: 'mdn', kind: 'page', title: p.length ? p[p.length - 1].replace(/_/g, ' ') : undefined, fallback: 'MDN', params: {}, fetchTitle: true };
  if (host === 'x.com' || host === 'twitter.com') return { source: 'x', kind: p.includes('status') ? 'post' : 'profile', fallback: p.includes('status') ? `Post by @${p[0]}` : p[0] ? `@${p[0]}` : 'X', params: {} };
  if (host === 'platform.openai.com' || host === 'openai.com' || host === 'chatgpt.com') return { source: 'openai', kind: 'page', fallback: host, params: {}, fetchTitle: host !== 'chatgpt.com' };
};

const microsoft: Parser = (_u, host, p) => {
  if (host.endsWith('.sharepoint.com')) {
    const file = p[p.length - 1];
    return { source: 'microsoft', kind: 'sharepoint', title: file && /\.\w{2,5}$/.test(file) ? file : undefined, fallback: 'SharePoint', context: host.split('.')[0].replace(/-my$/, ''), params: {} };
  }
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return { source: 'microsoft', kind: 'teams', fallback: 'Teams', params: {} };
  if (host === 'onedrive.live.com' || host === '1drv.ms') return { source: 'microsoft', kind: 'onedrive', fallback: 'OneDrive', params: {} };
  if (host === 'outlook.office.com' || host === 'outlook.live.com') return { source: 'microsoft', kind: 'outlook', fallback: 'Outlook', params: {} };
  if (host === 'learn.microsoft.com' || host === 'docs.microsoft.com') return { source: 'microsoft', kind: 'page', fallback: 'Microsoft Learn', params: {}, fetchTitle: true };
};

const claude: Parser = (_u, host, p) => {
  if (host === 'claude.ai') {
    if (p[0] === 'artifact' || (p[0] === 'code' && p[1] === 'artifact')) return { source: 'claude', kind: 'artifact', fallback: 'Artifact', params: {} };
    if (p[0] === 'design') return { source: 'claude', kind: 'design', fallback: 'Claude Design', params: {} };
    if (p[0] === 'chat') return { source: 'claude', kind: 'chat', fallback: 'Claude chat', params: {} };
    if (p[0] === 'project') return { source: 'claude', kind: 'project', fallback: 'Claude project', params: {} };
    if (p[0] === 'code') return { source: 'claude', kind: 'code', fallback: 'Claude Code', params: {} };
    return { source: 'claude', kind: 'page', fallback: 'Claude', params: {} };
  }
  if (['docs.claude.com', 'docs.anthropic.com', 'www.anthropic.com', 'anthropic.com', 'support.claude.com', 'code.claude.com', 'platform.claude.com', 'console.anthropic.com'].includes(host)) {
    return { source: 'claude', kind: 'page', fallback: host, params: {}, fetchTitle: !host.startsWith('console') && !host.startsWith('platform') };
  }
};

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
