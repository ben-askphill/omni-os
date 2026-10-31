// URL parsers for docs, design, chat, commerce, CMS, marketing, infra, dev and Claude links. Same contract as link-parsers-work.ts.
import { slugTitle, type LinkRef, type Parser, type SourceId } from './link-source-types.ts';

// ---------- docs, design, chat ----------

export const notion: Parser = (_u, host, p) => {
  if (host !== 'notion.so' && host !== 'www.notion.so' && !host.endsWith('.notion.site')) return;
  const last = p[p.length - 1] ?? '';
  const m = last.match(/^(?:(.*)-)?([0-9a-f]{32})$/i);
  if (!m) return { source: 'notion', kind: 'page', fallback: 'Notion', params: {} };
  const id = m[2].toLowerCase();
  return { source: 'notion', kind: 'page', title: slugTitle(m[1]), fallback: 'Page', params: { id } };
};

export const figma: Parser = (_u, host, p) => {
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

export const google: Parser = (u, host, p) => {
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

export const slack: Parser = (_u, host, p) => {
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

export const media: Parser = (u, host, p) => {
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

export const design: Parser = (_u, host, p) => {
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

export const shopify: Parser = (u, host, p) => {
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

export const cms: Parser = (_u, host, p) => {
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

export const marketing: Parser = (_u, host, p) => {
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

export const infra: Parser = (_u, host, p) => {
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

export const dev: Parser = (_u, host, p) => {
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

export const microsoft: Parser = (_u, host, p) => {
  if (host.endsWith('.sharepoint.com')) {
    const file = p[p.length - 1];
    return { source: 'microsoft', kind: 'sharepoint', title: file && /\.\w{2,5}$/.test(file) ? file : undefined, fallback: 'SharePoint', context: host.split('.')[0].replace(/-my$/, ''), params: {} };
  }
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return { source: 'microsoft', kind: 'teams', fallback: 'Teams', params: {} };
  if (host === 'onedrive.live.com' || host === '1drv.ms') return { source: 'microsoft', kind: 'onedrive', fallback: 'OneDrive', params: {} };
  if (host === 'outlook.office.com' || host === 'outlook.live.com') return { source: 'microsoft', kind: 'outlook', fallback: 'Outlook', params: {} };
  if (host === 'learn.microsoft.com' || host === 'docs.microsoft.com') return { source: 'microsoft', kind: 'page', fallback: 'Microsoft Learn', params: {}, fetchTitle: true };
};

export const claude: Parser = (_u, host, p) => {
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
