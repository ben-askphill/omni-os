// The sign-in check a thread or a scheduled automation runs before any harness starts (runner/setup.ts,
// automations.ts). A job that needs a connector (mail, calendar, Slack, Notion, Drive, Granola) that is signed out
// stops there, before it spends a token, and says in plain words which one to sign in to.
//
// Only Claude Code reports its connectors' sign-in state: each session's init lists every MCP server with a status
// (stream.ts), and `claude mcp list` checks them all in a few seconds without a model call; sign-in-check.ts reads both.
// This module is pure, so crew.ts can read a role's `connectors:` without loading more. Other
// harnesses' state is unknown, and unknown never holds a job.

export type SignInState = 'signed-in' | 'signed-out' | 'unknown';

export interface Connector {
  id: string;
  /** What the user calls it. */
  label: string;
  /** The MCP server names that are this connector, as Claude Code lists them ("claude.ai Slack", "plugin:slack:slack"). */
  server: RegExp;
  /** Words in a brief that mean the job reads or writes this account. Narrow on purpose: a false hit holds a job. */
  cue: RegExp;
}

/** The claude.ai page where a claude.ai connector is signed in to again. */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';

export const CONNECTORS: readonly Connector[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    server: /\bgmail\b/i,
    cue: /\bgmail\b|mail\.google\.com|\bmy (e-?mails?|mail|inbox)\b|\b(check|read|search|scan|triage|draft|reply to|go through)\s+(my\s+|the\s+)?(e-?mails?|mail|inbox)\b/i,
  },
  {
    id: 'calendar',
    label: 'Google Calendar',
    server: /\bcalendar\b/i,
    cue: /\bgoogle calendar\b|calendar\.google\.com|\bmy (calendar|meetings?|schedule)\b|\bcalendar (events?|invites?)\b|\b(check|read|scan|search|look at)\s+(my\s+|the\s+)?calendar\b/i,
  },
  {
    id: 'slack',
    label: 'Slack',
    server: /\bslack\b/i,
    cue: /\bslack\b(?!\s*(app|apps|api|bot|bots|sdk|webhook|webhooks|integration|cli|block kit|notification route)\b)|\b[\w-]+\.slack\.com\b/i,
  },
  {
    id: 'notion',
    label: 'Notion',
    server: /\bnotion\b/i,
    cue: /\bnotion\b(?!\s*(api|sdk|integration)\b)|\bnotion\.(so|site)\b/i,
  },
  {
    id: 'drive',
    label: 'Google Drive',
    server: /\b(google )?drive\b/i,
    cue: /\bgoogle (drive|docs?|sheets?|slides)\b|\b(docs|drive|sheets)\.google\.com\b/i,
  },
  {
    id: 'granola',
    label: 'Granola',
    server: /\bgranola\b/i,
    cue: /\bgranola\b/i,
  },
];

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);

/** The connectors a brief names, in catalog order. */
export const connectorsIn = (text: string): string[] => CONNECTORS.filter((c) => c.cue.test(text)).map((c) => c.id);

/**
 * `connectors:` in an automation's YAML or a role's frontmatter: one id or a list of them. The ids, or the problem
 * as a string. Ids are the catalog's (gmail, calendar, slack, notion, drive, granola), or its labels in any case.
 */
export function parseConnectorList(raw: unknown): string[] | string {
  const list = typeof raw === 'string' ? raw.split(',') : raw;
  if (!Array.isArray(list)) return 'connectors must be a list such as [slack, calendar]';
  const ids: string[] = [];
  for (const item of list) {
    const name = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!name) continue;
    const c = CONNECTORS.find((x) => x.id === name || x.label.toLowerCase() === name);
    if (!c) return `unknown connector "${String(item)}": use ${CONNECTORS.map((x) => x.id).join(', ')}`;
    if (!ids.includes(c.id)) ids.push(c.id);
  }
  return ids;
}

/** The declared connectors, then the ones the brief names, without repeats. */
export const neededConnectors = (prompt: string, ...declared: (readonly string[] | undefined)[]) => [
  ...new Set([...declared.flatMap((d) => d ?? []), ...connectorsIn(prompt)]),
];

// ---------- server states ----------

/** An MCP server's status as Claude Code names it: connected, needs-auth, failed, pending or disabled. */
export type ServerStates = Map<string, string>;

/** A session init's `mcp` list (stream.ts): "name:status", where the name may itself hold colons. */
export function parseInitServers(list: readonly string[]): ServerStates {
  const out: ServerStates = new Map();
  for (const entry of list) {
    const at = entry.lastIndexOf(':');
    if (at > 0) out.set(entry.slice(0, at), entry.slice(at + 1));
  }
  return out;
}

/** `claude mcp list`'s lines: "name: target - ✔ Connected", "! Needs authentication" or "✘ Failed to connect". */
export function parseMcpList(stdout: string): ServerStates {
  const out: ServerStates = new Map();
  for (const line of stdout.split('\n')) {
    const m = /^(.+?): .* - (.+)$/.exec(line.trim());
    if (!m) continue;
    const said = m[2];
    const status = /\bconnected\b/i.test(said) && !/failed/i.test(said)
      ? 'connected'
      : /needs auth/i.test(said)
        ? 'needs-auth'
        : /failed/i.test(said)
          ? 'failed'
          : /disabled/i.test(said)
            ? 'disabled'
            : 'pending';
    out.set(m[1], status);
  }
  return out;
}

/**
 * One connector's state from the servers: signed in when any of its servers is connected, signed out when none is
 * and at least one needs a sign-in, otherwise unknown (not installed, failed for another reason, still starting).
 */
export function connectorState(id: string, servers: ServerStates): { state: SignInState; servers: string[] } {
  const c = connectorById(id);
  if (!c) return { state: 'unknown', servers: [] };
  const mine = [...servers].filter(([name]) => c.server.test(name));
  const names = mine.map(([name]) => name);
  if (mine.some(([, s]) => s === 'connected')) return { state: 'signed-in', servers: names };
  if (mine.some(([, s]) => s === 'needs-auth')) return { state: 'signed-out', servers: names };
  return { state: 'unknown', servers: names };
}

export interface SignedOut {
  id: string;
  label: string;
  /** Where to sign in again in one click, when there is such a page: claude.ai's connector settings. */
  url: string | null;
}

export interface SignInCheck {
  signedOut: SignedOut[];
  signedIn: string[];
  unknown: string[];
}

export function judge(ids: readonly string[], servers: ServerStates | null): SignInCheck {
  const out: SignInCheck = { signedOut: [], signedIn: [], unknown: [] };
  for (const id of ids) {
    const { state, servers: names } = servers ? connectorState(id, servers) : { state: 'unknown' as const, servers: [] };
    if (state === 'signed-in') out.signedIn.push(id);
    else if (state === 'unknown') out.unknown.push(id);
    else
      out.signedOut.push({
        id,
        label: connectorById(id)!.label,
        url: names.some((n) => n.startsWith('claude.ai ') && servers!.get(n) === 'needs-auth') ? CLAUDE_CONNECTORS_URL : null,
      });
  }
  return out;
}

const listed = (labels: string[]) => (labels.length < 3 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`);

/**
 * What the user reads: which connector is signed out, where, and how to sign in. Plain words, no server names. A
 * claude.ai connector's sign-in page is written out in full, so a client that shows only the text still links it.
 */
export function signInMessage(out: readonly SignedOut[], machine: string | null): string {
  const labels = out.map((c) => c.label);
  const where = machine ? ` on ${machine}` : '';
  const verb = out.length === 1 ? 'is' : 'are';
  const web = out.filter((c) => c.url);
  const local = out.filter((c) => !c.url);
  const steps = [
    web.length ? `Sign in to ${listed(web.map((c) => c.label))} at ${CLAUDE_CONNECTORS_URL}` : null,
    local.length ? `Sign in to ${listed(local.map((c) => c.label))} by running claude in a terminal and typing /mcp` : null,
  ].filter(Boolean);
  return `${listed(labels)} ${verb} signed out${where}, so this job has not started and nothing was spent. ${steps.join('. ')}, then press Try again.`;
}
