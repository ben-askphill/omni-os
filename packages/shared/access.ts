// Access levels: how much a channel's agents may do without a yes from the user, and the same per connector (an
// account such as Gmail or Slack, or the browser) inside a channel. Pure: the server enforces them
// (apps/server/access.ts), the clients show and set them. ADR 0015 has the why.
import type { Question } from './question.ts';

/**
 * - read: reading and searching only. Anything that changes something is refused.
 * - ask: reading, searching and edits inside the thread's own folder run. A command that may change something, an edit
 *   elsewhere and a connector action that sends, changes or deletes wait for a yes ("Ask first").
 * - full: everything runs without asking, as every channel did before levels. A channel with no level is this.
 */
export type AccessLevel = 'read' | 'ask' | 'full';
/** A connector's level: one of the channel's, or off, where even its reading tools are refused. */
export type ConnectorLevel = AccessLevel | 'off';

export interface LevelChoice<T extends string> {
  id: T;
  label: string;
  description: string;
}

export const ACCESS_LEVELS: readonly LevelChoice<AccessLevel>[] = [
  { id: 'read', label: 'Read only', description: 'Agents read, search and answer. File edits, commands that change things and account actions are refused.' },
  {
    id: 'ask',
    label: 'Ask first',
    description: 'Reading, searching and edits in the thread’s own folder run. Commands that change things, edits elsewhere and account actions wait for your yes.',
  },
  { id: 'full', label: 'Full access', description: 'Agents run every tool without asking, with full access to this computer.' },
];

export const CONNECTOR_LEVELS: readonly LevelChoice<ConnectorLevel>[] = [
  { id: 'off', label: 'Off', description: 'Agents cannot use it, not even to read.' },
  ...ACCESS_LEVELS,
];

/** A new install's channels start here (M1). Channels made before levels have none, which reads as full access. */
export const NEW_INSTALL_ACCESS: AccessLevel = 'ask';

export const isAccessLevel = (v: unknown): v is AccessLevel => v === 'read' || v === 'ask' || v === 'full';
export const isConnectorLevel = (v: unknown): v is ConnectorLevel => v === 'off' || isAccessLevel(v);

/** A stored level: null, missing or unknown reads as full access, which is how every channel ran before levels. */
export const accessLevelOf = (v: unknown): AccessLevel => (isAccessLevel(v) ? v : 'full');

const RANK: Record<ConnectorLevel, number> = { off: -1, read: 0, ask: 1, full: 2 };
/** The stricter of two levels. */
export const stricter = <T extends ConnectorLevel>(a: T, b: T): T => (RANK[a] <= RANK[b] ? a : b);

export const accessLabel = (level: ConnectorLevel) => CONNECTOR_LEVELS.find((l) => l.id === level)!.label;

// ---------- connectors ----------

/** The accounts a level can be set for. `server` matches the MCP server names that are this account. */
export interface AccessConnector {
  id: string;
  label: string;
  server: RegExp;
}

export const ACCESS_CONNECTORS: readonly AccessConnector[] = [
  { id: 'gmail', label: 'Gmail', server: /\bgmail\b/i },
  { id: 'calendar', label: 'Google Calendar', server: /\bcalendar\b/i },
  { id: 'slack', label: 'Slack', server: /\bslack\b/i },
  { id: 'notion', label: 'Notion', server: /\bnotion\b/i },
  { id: 'drive', label: 'Google Drive', server: /\b(google )?drive\b/i },
  { id: 'granola', label: 'Granola', server: /\bgranola\b/i },
  { id: 'browser', label: 'Browser', server: /\bbrowser\b|\bplaywright\b|\bchrome devtools\b/i },
];

/** Per connector levels inside a channel, keyed by connector id. A connector left out follows the channel. */
export type ConnectorAccess = Record<string, ConnectorLevel>;

/**
 * Which connector an MCP server is, by its name as Claude Code lists it ("claude.ai Slack", "plugin:slack:slack") or as
 * its tools carry it ("claude_ai_Slack", "omni-browser"). Null for a server that is none of them.
 */
export function connectorIdOf(server: string): string | null {
  const words = server.replace(/[_:.\-]+/g, ' ');
  return ACCESS_CONNECTORS.find((c) => c.server.test(words))?.id ?? null;
}

/** The stored JSON map, or {} when it is missing or broken. Unknown ids and levels are dropped. */
export function connectorAccessOf(raw: unknown): ConnectorAccess {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: ConnectorAccess = {};
  for (const [k, level] of Object.entries(v as Record<string, unknown>)) {
    if (ACCESS_CONNECTORS.some((c) => c.id === k) && isConnectorLevel(level)) out[k] = level;
  }
  return out;
}

/** Omni's own MCP servers. Their tools run at every level: Omni checks what they do itself. */
export const OMNI_SERVERS = new Set(['omni', 'omni-ask', 'omni-render', 'omni-threads', 'omni-steps', 'omni-learn']);

/** The MCP server a tool belongs to, or null for a built-in tool. Claude Code names them `mcp__<server>__<tool>`. */
export function serverOf(tool: string): string | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  return m ? m[1] : null;
}

/** An MCP server as people know it: "claude_ai_Gmail" is Gmail, "omni-browser" is Browser. */
export function serverLabel(server: string): string {
  const id = connectorIdOf(server);
  if (id) return ACCESS_CONNECTORS.find((c) => c.id === id)!.label;
  return server.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ').trim() || server;
}

/** A channel's levels as one line, for a channel list or the Conductor: "Ask first", "Read only, Gmail off". */
export function accessSummary(level: AccessLevel, connectors: ConnectorAccess): string {
  const apart = Object.entries(connectors)
    .filter(([, l]) => l !== level)
    .map(([id, l]) => `${ACCESS_CONNECTORS.find((c) => c.id === id)?.label ?? id} ${accessLabel(l).toLowerCase()}`);
  return [accessLabel(level), ...apart].join(', ');
}

// ---------- approvals ----------

/** The approval card's choices, as question option labels. Any other answer (a typed note) refuses with that note. */
export const APPROVE_ONCE = 'Allow';
export const APPROVE_THREAD = 'Allow in this thread';
export const APPROVE_ROLE_PREFIX = 'Always allow for';
export const REFUSE = 'Don’t allow';
/** "Always allow for Builder": the role's grant in this channel, kept until the user removes it in Channel settings. */
export const approveRoleLabel = (roleName: string) => `${APPROVE_ROLE_PREFIX} ${roleName}`;

/** What an approval asks about, on a question event (packages/shared/question.ts QuestionPayload.approval). */
export interface ApprovalRequest {
  /** The tool's name as the harness calls it: Bash, Edit, mcp__claude_ai_Gmail__create_draft, command, file change. */
  tool: string;
  /** What the agent wants to do, one line: the command, the file, or the account action. */
  summary: string;
  /** More of the input, for the card's detail: the full command or the call's arguments. */
  detail?: string;
  /** The connector it goes to, when it is one (ACCESS_CONNECTORS id, or the MCP server name for another server). */
  connector?: string;
  /** The level that asked: the channel's or the connector's. */
  level: ConnectorLevel;
  /** The crew role the thread runs as, when it has one: "Always allow for <role>" is offered for it. */
  role?: string;
}

/** How the card names the action: "Run a command", "Change a file", "Gmail: create draft". */
export function approvalTitle(a: Pick<ApprovalRequest, 'tool' | 'connector'>): string {
  const server = serverOf(a.tool);
  if (server) {
    const action = a.tool.slice(`mcp__${server}__`.length).replace(/[_-]+/g, ' ');
    return `${serverLabel(server)}: ${action}`;
  }
  if (/^(bash|powershell|command)$/i.test(a.tool)) return 'Run a command';
  if (/^(edit|write|multiedit|notebookedit|file change)$/i.test(a.tool)) return 'Change a file';
  return `Use ${a.tool}`;
}

/** The approval as a question card: every client already shows, answers, syncs and alerts those. */
export function approvalQuestion(a: ApprovalRequest, roleName?: string | null): Question {
  const options = [
    { label: APPROVE_ONCE, description: 'Run it this once.' },
    { label: APPROVE_THREAD, description: 'Run this tool without asking for the rest of this thread.' },
    ...(roleName ? [{ label: approveRoleLabel(roleName), description: `Run this tool without asking for ${roleName} in this channel.` }] : []),
    { label: REFUSE, description: 'Stop it. The agent hears you said no.' },
  ];
  return { question: `${approvalTitle(a)}: ${a.summary}`, header: 'Ask first', options, multiSelect: false };
}

/** The grant an approval's answer makes, if any. A typed note or a refusal makes none and refuses. */
export function approvalGrant(answer: { selected: string[]; other: string | null } | null): 'once' | 'thread' | 'role' | null {
  if (!answer || answer.other || answer.selected.length !== 1) return null;
  const [pick] = answer.selected;
  if (pick === APPROVE_ONCE) return 'once';
  if (pick === APPROVE_THREAD) return 'thread';
  if (pick.startsWith(APPROVE_ROLE_PREFIX)) return 'role';
  return null;
}
