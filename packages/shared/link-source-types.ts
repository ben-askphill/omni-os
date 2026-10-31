// Which tool a link points into, and what it points at, read from the URL alone. Pure: the server's link
// resolver (apps/server/links.ts) starts from this and fills in the live title; both clients only draw what it sends.
// A link no source claims is a plain web page, whose <title> the resolver may fetch.

export type SourceId =
  | 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'jira' | 'confluence' | 'trello' | 'linear' | 'asana'
  | 'clickup' | 'notion' | 'figma' | 'miro' | 'canva' | 'framer' | 'webflow' | 'shopify' | 'productive' | 'slack'
  | 'google-docs' | 'google-sheets' | 'google-slides' | 'google-forms' | 'google-drive' | 'google-calendar' | 'gmail'
  | 'google-meet' | 'loom' | 'youtube' | 'vimeo' | 'vercel' | 'netlify' | 'sentry' | 'cloudflare' | 'npm'
  | 'stackoverflow' | 'mdn' | 'claude' | 'prismic' | 'datocms' | 'contentful' | 'sanity' | 'storyblok' | 'hubspot'
  | 'klaviyo' | 'airtable' | 'dropbox' | 'microsoft' | 'supabase' | 'postman' | 'algolia' | 'stripe' | 'openai'
  | 'zendesk' | 'intercom' | 'x' | 'web';

/** Display name and icon (a key of LINK_ICONS in packages/shared/link-icons.ts) per source. */
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

export type Parser = (u: URL, host: string, p: string[]) => LinkRef | null | undefined;
