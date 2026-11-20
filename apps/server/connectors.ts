// The sign-in check a thread or a scheduled automation runs before any harness starts (runner/setup.ts,
// automations.ts). A job that needs a connector (mail, calendar, Slack, Notion, Drive, Granola) that is signed out
// stops there, before it spends a token, and says in plain words which one to sign in to.
//
// Only Claude Code reports its connectors' sign-in state: each session's init lists every MCP server with a status
// (stream.ts), and `claude mcp list` checks them all in a few seconds without a model call; sign-in-check.ts reads both.
// This module is pure, so crew.ts can read a role's `connectors:` without loading more. Other
// harnesses' state is unknown, and unknown never holds a job.

import { ACCESS_CONNECTORS, type AccessConnector } from '@omni/shared/access.ts';

export type SignInState = 'signed-in' | 'signed-out' | 'unknown';

/** A connector the sign-in check knows: the shared catalog's (packages/shared/access.ts), with the brief cue. */
export interface Connector extends AccessConnector {
  /** Words in a brief that mean the job reads or writes this account. Narrow on purpose: a false hit holds a job. */
  cue: RegExp;
}

/** The claude.ai page where a claude.ai connector is signed in to again. */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';

// ---------- what a brief asks for ----------
//
// A brief needs an account only when it asks to use it: "check my Slack", "post the summary to Slack", "add a task to
// the Notion tracker". Naming the product is not that: a brief about how Ben writes Slack replies, or one debugging
// this check, says "Slack" a dozen times and needs no sign-in. A false hit holds a job that may have nobody watching
// it, while a miss only lets the job start and meet the signed-out account itself, so every cue leans towards a miss.
// What a brief quotes (code, quoted lines and strings) is left out first: it is material the job works on, not its ask.

/** Verbs that read an account. Words that are mostly nouns in a brief (reply, message, review) are left out. */
const READ = 'check|read|search|scan|triage|monitor|summari[sz]e|go through|look through|look in|catch up on|pull|fetch|grab|gather|collect|open|query';
/** Verbs that send through one. */
const SEND = 'post|send|forward|ping|notify|dm|share';
/** Verbs that write to one. */
const WRITE = 'add|write|save|create|edit|update|put|copy|move|sync|import|export|upload|download|archive|delete';

/** What may follow an account's bare name when it is the thing acted on: the end of a clause, or a joining word. */
const AFTER = 'for|and|or|to|about|from|with|since|today|tonight|tomorrow|yesterday|now|first|again|every|each|daily|this|last|over|until|before|after|if|when|while';

interface CueWords {
  /** The account's name, as regex source. */
  name: string;
  verbs: string;
  /** Nouns after the name that make it the account itself: "Slack DMs", "the Notion tracker". */
  things: string;
  /** Words after the name that make it something else: "a Slack app", "the Notion API". */
  not: string;
  /** Names that count only after "my": "my meetings". */
  mine?: string;
  /** Other sure signs, such as a link into the account. */
  also?: string;
}

/**
 * The cue for one account: "my <name>", a verb on it ("search Slack for"), a verb on a list that ends with it ("go
 * through my inbox and the calendar"), or a verb that reaches it through a preposition ("post the summary to Slack").
 * The name must be the thing acted on, so "check the Slack formatting skill" is no hit. Every gap stays on one line.
 */
function cue({ name, verbs, things, not, mine, also }: CueWords): RegExp {
  const sp = '[^\\S\\n]+';
  const owner = `(?:(?:my|our|the|ben'?s|his|her|their)${sp})?`;
  const gap = (n: number) => `(?:(?:${sp}|,[^\\S\\n]*)[^\\s.;:!?,]+){0,${n}}?`;
  const named = (n: string) => `(?:${n})(?![\\w-])(?!${sp}(?:${not})\\b)`;
  const object = `(?:${sp}(?:${things})\\b|(?=[^\\S\\n]*(?:[.,;:!?)]|$)|${sp}(?:${AFTER})\\b))`;
  const forms = [
    `\\bmy${sp}${named(name)}${object}`,
    `\\b(?:${verbs})${sp}${owner}${named(name)}${object}`,
    `\\b(?:${verbs})${gap(4)}(?:,[^\\S\\n]*|${sp}(?:and|or|&)${sp})${owner}${named(name)}${object}`,
    `\\b(?:${verbs})${gap(6)}${sp}(?:in|on|to|into|onto|from|via|through|across)${sp}${owner}${named(name)}`,
    ...(mine ? [`\\bmy${sp}${named(mine)}${object}`] : []),
    ...(also ? [also] : []),
  ];
  return new RegExp(forms.join('|'), 'im');
}

/** Words after a name that make it a thing built or configured, not the account the job uses. */
const BUILT = 'api|apis|sdk|integration|integrations|mcp|plugin|plugins|connector|connectors|connection|token|cli|skill|skills';

const CUES: Record<string, RegExp> = {
  gmail: cue({
    name: 'gmail|e-?mails?|mail|inbox',
    verbs: `${READ}|${SEND}|archive|delete|label|draft|reply to`,
    things: 'inbox|threads?|messages?|drafts?|labels?|e-?mails?|account',
    not: `${BUILT}|smtp|merge|server|component|page|cards?|list|view|zero|rules?`,
    also: 'mail\\.google\\.com',
  }),
  calendar: cue({
    name: '(?:google[^\\S\\n]+)?calendar',
    verbs: `${READ}|add|create|schedule|book|move|delete|invite|block`,
    things: 'events?|invites?|invitations?|meetings?|availability|slots?|schedule|entries',
    not: `${BUILT}|component|view|page|widget|picker|ui|grid`,
    mine: 'meetings?|schedule|agenda',
    also: 'calendar\\.google\\.com',
  }),
  slack: cue({
    name: 'slack',
    verbs: `${READ}|${SEND}`,
    things: 'dms?|direct messages?|channels?|threads?|mentions?|inbox|workspace|history|conversations?|unreads?|activity',
    not: `${BUILT}|app|apps|bot|bots|webhook|webhooks|block kit|notification route|formatting|mrkdwn|sign-?in`,
    also: '\\b[\\w-]+\\.slack\\.com\\b',
  }),
  notion: cue({
    name: 'notion',
    verbs: `${READ}|${WRITE}|log|file`,
    things: 'pages?|databases?|db|tasks?|task tracker|tracker|workspace|notes|wiki|boards?|projects?',
    not: BUILT,
    also: '\\bnotion\\.(?:so|site)\\b',
  }),
  drive: cue({
    name: 'google[^\\S\\n]+(?:drive|docs?|sheets?|slides)',
    verbs: `${READ}|${WRITE}|${SEND}`,
    things: 'folders?|files?|docs?|documents?|sheets?|spreadsheets?|slides|decks?',
    not: BUILT,
    also: '\\b(?:docs|drive|sheets|slides)\\.google\\.com\\b',
  }),
  granola: cue({
    name: 'granola',
    verbs: `${READ}|export|copy|sync|import`,
    things: 'notes|meetings?|transcripts?|summar(?:y|ies)|folders?',
    not: BUILT,
  }),
};

/** The accounts a sign-in can be checked for: every shared connector but the browser, which needs none. */
export const CONNECTORS: readonly Connector[] = ACCESS_CONNECTORS.filter((c) => CUES[c.id]).map((c) => ({ ...c, cue: CUES[c.id] }));

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);

/** A brief without what it quotes: fenced and inline code, quoted lines and quoted strings. */
export const askOf = (text: string) =>
  text
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^[^\S\n]*>.*$/gm, ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ');

/** The connectors a brief asks to use, in catalog order. Naming one is not asking to use it. */
export const connectorsIn = (text: string): string[] => {
  const ask = askOf(text);
  return CONNECTORS.filter((c) => c.cue.test(ask)).map((c) => c.id);
};

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
