// Connectors: the MCP servers and claude.ai connectors a thread's calls reach, named and marked the way people know
// them (Granola, Notion, Gmail), as Claude's own apps show them. A call to `mcp__claude_ai_Granola__search_meetings`
// is Granola's "Search meetings", not a raw tool name. The browser servers and the built-in tools (shell, file edits,
// search) are not connectors and keep their own look. Pure: the web, the phone layout and the iOS app read it.
import type { ToolCall } from './transcript-fold.ts';

/** How a connector's tile is drawn. */
export type ConnectorMark =
  /** A brand mark, a key of LINK_ICONS (link-icons.ts). */
  | { type: 'logo'; icon: string }
  /** Omni's own ring. */
  | { type: 'omni' }
  /** A known brand with no mark to draw: its initial. */
  | { type: 'letter'; text: string }
  /** A server Omni does not know: a neutral plug. */
  | { type: 'generic' };

export interface Connector {
  /** Stable across calls: `granola`, `google-calendar`, or `mcp:<server>` for one Omni does not know. */
  id: string;
  /** As people say it: "Granola", "Google Calendar", "Acme crm". */
  name: string;
  mark: ConnectorMark;
  /** `omni` for Omni's own servers (the Conductor's tools, steps, questions, pages): they list apart from outside apps. */
  kind: 'connector' | 'omni';
}

/** `mcp__<server>__<tool>`, the name every harness gives an MCP call (Codex swaps the dashes for underscores in some). */
export function mcpParts(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}

/** A claude.ai connector added from claude.ai's settings, named by its id, not its app. */
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

/** The browser servers: the thread's own browser, Playwright and Chrome DevTools. They keep the browser's globe. */
export const BROWSER_SERVER = /browser|playwright|chrome-devtools|puppeteer/i;

/**
 * The server name without the wrapper a client gives it: claude_ai_Google_Drive (a tool's prefix) and "claude.ai Google
 * Drive" (the name init lists) are Google Drive, plugin_github_github and plugin:github:github are github.
 */
const bare = (server: string) => server.replace(/^claude[_.]ai[_ ]/i, '').replace(/^plugin[_:][^_:]+[_:]/i, '');

/** A server's name as people say it, for one Omni does not know: acme_crm is "Acme crm". */
export function prettyServer(server: string): string {
  if (UUID.test(server)) return 'Connected app';
  const name = bare(server)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Connected app';
}

/** Known connectors, matched on the bare server name with spaces for `_` and `-`, most specific first. Icon: a LINK_ICONS key. */
const KNOWN: { re: RegExp; id: string; name: string; icon?: string }[] = [
  { re: /^granola\b/, id: 'granola', name: 'Granola' },
  { re: /^(gmail|google mail)\b/, id: 'gmail', name: 'Gmail', icon: 'gmail' },
  { re: /^google calendar\b/, id: 'google-calendar', name: 'Google Calendar', icon: 'google-calendar' },
  { re: /^google drive\b/, id: 'google-drive', name: 'Google Drive', icon: 'google-drive' },
  { re: /^google docs\b/, id: 'google-docs', name: 'Google Docs', icon: 'google-docs' },
  { re: /^google sheets\b/, id: 'google-sheets', name: 'Google Sheets', icon: 'google-sheets' },
  { re: /^google slides\b/, id: 'google-slides', name: 'Google Slides', icon: 'google-slides' },
  { re: /^(google analytics|analytics mcp)\b/, id: 'google-analytics', name: 'Google Analytics', icon: 'google-analytics' },
  { re: /^notion\b/, id: 'notion', name: 'Notion', icon: 'notion' },
  { re: /^slack\b/, id: 'slack', name: 'Slack', icon: 'slack' },
  { re: /^linear\b/, id: 'linear', name: 'Linear', icon: 'linear' },
  { re: /^figma\b/, id: 'figma', name: 'Figma', icon: 'figma' },
  { re: /^github\b/, id: 'github', name: 'GitHub', icon: 'github' },
  { re: /^shopify\b/, id: 'shopify', name: 'Shopify', icon: 'shopify' },
  { re: /^vercel\b/, id: 'vercel', name: 'Vercel', icon: 'vercel' },
  { re: /^supabase\b/, id: 'supabase', name: 'Supabase', icon: 'supabase' },
  { re: /^(atlassian|jira)\b/, id: 'atlassian', name: 'Atlassian', icon: 'atlassian' },
  { re: /^confluence\b/, id: 'confluence', name: 'Confluence', icon: 'confluence' },
  { re: /^canva\b/, id: 'canva', name: 'Canva', icon: 'canva' },
  { re: /^asana\b/, id: 'asana', name: 'Asana', icon: 'asana' },
  { re: /^hubspot\b/, id: 'hubspot', name: 'HubSpot', icon: 'hubspot' },
  { re: /^intercom\b/, id: 'intercom', name: 'Intercom', icon: 'intercom' },
  { re: /^miro\b/, id: 'miro', name: 'Miro', icon: 'miro' },
  { re: /^clickup\b/, id: 'clickup', name: 'ClickUp', icon: 'clickup' },
  { re: /^airtable\b/, id: 'airtable', name: 'Airtable', icon: 'airtable' },
  { re: /^stripe\b/, id: 'stripe', name: 'Stripe', icon: 'stripe' },
  { re: /^sentry\b/, id: 'sentry', name: 'Sentry', icon: 'sentry' },
  { re: /^cloudflare\b/, id: 'cloudflare', name: 'Cloudflare', icon: 'cloudflare' },
  { re: /^dropbox\b/, id: 'dropbox', name: 'Dropbox', icon: 'dropbox' },
  { re: /^box\b/, id: 'box', name: 'Box', icon: 'box' },
  { re: /^zendesk\b/, id: 'zendesk', name: 'Zendesk', icon: 'zendesk' },
  { re: /^framer\b/, id: 'framer', name: 'Framer', icon: 'framer' },
  { re: /^webflow\b/, id: 'webflow', name: 'Webflow', icon: 'webflow' },
  { re: /^algolia\b/, id: 'algolia', name: 'Algolia', icon: 'algolia' },
  { re: /^spotify\b/, id: 'spotify', name: 'Spotify', icon: 'spotify' },
  { re: /^todoist\b/, id: 'todoist', name: 'Todoist', icon: 'todoist' },
  { re: /^excalidraw\b/, id: 'excalidraw', name: 'Excalidraw', icon: 'excalidraw' },
  { re: /^claude docs\b/, id: 'claude-docs', name: 'Claude Docs', icon: 'claude' },
  { re: /^claude data\b/, id: 'claude-data', name: 'Claude Data', icon: 'claude' },
  { re: /^claude design\b/, id: 'claude-design', name: 'Claude Design', icon: 'claude' },
  { re: /^klaviyo\b/, id: 'klaviyo', name: 'Klaviyo' },
];

export const OMNI_CONNECTOR: Connector = { id: 'omni', name: 'Omni', mark: { type: 'omni' }, kind: 'omni' };

/** Omni's own servers: `omni` (the Conductor's tools) and the per-thread `omni-ask`, `omni-steps`, `omni-render`, `omni-threads`. */
const OMNI_SERVER = /^omni([-_](ask|steps|render|threads))?$/;

/** The connector behind a server, or null for a browser server, which is not one. */
export function connectorFor(server: string): Connector | null {
  if (BROWSER_SERVER.test(server)) return null;
  if (OMNI_SERVER.test(server)) return OMNI_CONNECTOR;
  const words = bare(server)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();
  const known = KNOWN.find((k) => k.re.test(words));
  if (known) return { id: known.id, name: known.name, mark: known.icon ? { type: 'logo', icon: known.icon } : { type: 'letter', text: known.name[0] }, kind: 'connector' };
  return { id: `mcp:${server}`, name: prettyServer(server), mark: { type: 'generic' }, kind: 'connector' };
}

/** The connector a call reaches, or null for a built-in tool or the browser. */
export function connectorOf(toolName: string): Connector | null {
  const p = mcpParts(toolName);
  return p ? connectorFor(p.server) : null;
}

/** An outside app, not Omni's own: the calls the transcript shows inline and the thread's Connectors list names. */
export const isOutsideConnector = (c: Connector | null): c is Connector => !!c && c.kind === 'connector';

/**
 * What a connector call does, from its tool name: `search_meetings` is "Search meetings", `notion-fetch` is "Fetch",
 * `slack_send_message` is "Send message", `getJiraIssue` is "Get jira issue". A tool that repeats its app's name drops it.
 */
export function connectorAction(toolName: string): string {
  const p = mcpParts(toolName);
  const tool = p ? p.tool : toolName;
  const app = p ? connectorFor(p.server) : null;
  const appWords = new Set((app && app.kind === 'connector' ? app.name : '').toLowerCase().split(/\s+/).filter(Boolean));
  let words = tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  // "notion-search", "slack_send_message": the app's own name leading the tool says nothing new.
  while (words.length > 1 && appWords.has(words[0])) words = words.slice(1);
  const text = words.join(' ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Call';
}

/** One connector a thread used: how many calls it took, and whether one still runs or failed. */
export interface ConnectorUse {
  connector: Connector;
  calls: number;
  running: number;
  failed: number;
}

/**
 * The outside connectors these calls reached, sub-agents' calls included, in the order the thread first used them.
 * Omni's own servers and the browser are left out: every thread has them.
 */
export function connectorsUsed(calls: readonly ToolCall[]): ConnectorUse[] {
  const out = new Map<string, ConnectorUse>();
  const walk = (cs: readonly ToolCall[]) => {
    for (const c of cs) {
      const k = connectorOf(c.name);
      if (isOutsideConnector(k)) {
        const use = out.get(k.id) ?? { connector: k, calls: 0, running: 0, failed: 0 };
        use.calls += 1;
        if (!c.result) use.running += 1;
        else if (c.result.is_error) use.failed += 1;
        out.set(k.id, use);
      }
      walk(c.children);
    }
  };
  walk(calls);
  return [...out.values()];
}

/** A run of one connector's calls inside a tool group, as the transcript shows it: one row per connector. */
export interface ConnectorGroup {
  connector: Connector;
  calls: ToolCall[];
}

/** The outside connector calls of one tool group (top level), one group per connector in first-use order. */
export function connectorGroups(calls: readonly ToolCall[]): ConnectorGroup[] {
  const out = new Map<string, ConnectorGroup>();
  for (const c of calls) {
    const k = connectorOf(c.name);
    if (!isOutsideConnector(k)) continue;
    const g = out.get(k.id) ?? { connector: k, calls: [] };
    g.calls.push(c);
    out.set(k.id, g);
  }
  return [...out.values()];
}
