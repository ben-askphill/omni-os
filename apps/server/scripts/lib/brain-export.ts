// Turns Omni threads into markdown digests for the central brain's ingest prompt (~/central-brain/raw/omni/).
// Reads a DatabaseSync it is handed and never writes to it; no db.ts import, so tests run it on a temp DB.
// The CLI (scripts/brain-export.ts) writes the files and keeps the cursor in kv.

import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { matchChannel } from './claude-session.ts';

/** kv key holding what was exported per thread. Synced, so the cursor follows whichever Mac owns the export. */
export const CURSOR_KEY = 'brain_export.cursor';
export const IMPORTED = { id: 'imported', name: 'Imported history', kind: 'internal' } as const;
/** Channels whose threads never go to the brain. */
export const SKIP_CHANNELS = new Set(['testrepo']);

/** Working notes before a turn's final reply are cut to this many characters. */
export const NOTES_MAX = 1200;
/** A crew report repeats the child's whole turn, which the child's own digest carries. Keep its tail. */
export const CREW_REPORT_MAX = 2000;
export const SUBAGENT_SUMMARY_MAX = 400;

export interface Cursor {
  version: 1;
  threads: Record<string, { uid: string; part: number }>;
}
export const emptyCursor = (): Cursor => ({ version: 1, threads: {} });

interface ChannelRow {
  id: string;
  name: string;
  kind: string;
  repo_path: string | null;
  base_dir: string | null;
}
interface ThreadRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  role: string | null;
  model: string | null;
  cwd: string;
  parent_id: string | null;
  task_id: string | null;
  source: string;
  harness: string;
  archived: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface EventRow {
  id: number;
  uid: string;
  kind: string;
  payload: string;
  created_at: string;
}

export type SkipReason = 'test-channel' | 'running' | 'archived-noise' | 'scratch-cwd' | 'no-content' | 'up-to-date' | 'cursor-lost';

export interface Digest {
  threadId: string;
  channelId: string;
  /** Relative to the export root, like omni/moby/2026-10-14-c92f088b.md. */
  path: string;
  content: string;
  part: number;
  lastUid: string;
}

export type Planned = { thread: ThreadRow; digest: Digest } | { thread: ThreadRow; skip: SkipReason };

export interface PlanOptions {
  channel?: string;
  /** ISO date; threads last updated before it are left out. */
  since?: string;
  /** Ben's home dir: imported history that ran there goes to imported/home. */
  home?: string;
  cursor: Cursor;
  redact: (s: string) => string;
  timezone?: string;
}

// ---------- redaction ----------

const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?)$/;

/** Token shapes worth redacting even when Omni never stored them. Each match is replaced whole unless it has a `keep` group. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bshp(?:at|ss|ca|pa)_[A-Fa-f0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}/g,
  /\b[rp]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bhooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  /\bdiscord(?:app)?\.com\/api\/webhooks\/[A-Za-z0-9/_-]+/g,
];

// SSH details: key files, user@host targets on ssh/scp/rsync lines, ssh:// URLs, host keys and fingerprints.
const SSH_PATTERNS: RegExp[] = [
  /^.*\b(?:ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com)\s+(?:AAAA[A-Za-z0-9+/=]+|\[REDACTED\]).*$/gm,
  /\bSHA256:[A-Za-z0-9+/]{43}=?/g,
  /\bssh:\/\/[^\s"'`)>\]]+/g,
  /[^\s"'`(=]*\/\.ssh\/[^\s"'`)]+/g,
  /\bid_(?:rsa|ed25519|ecdsa|dsa)(?:_[\w-]+)?(?:\.pub)?\b/g,
  /[\w.-]+\.(?:pem|ppk)\b/g,
];
const SSH_COMMAND = /\b(?:ssh|scp|sftp|rsync|mosh|ssh-copy-id|ssh-keyscan)\b/;

const IPV4 = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d]|\.\d)/g;
const IPV6 = /(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])/g;

/** Loopback and the any-address are not secrets, so they stay. */
const keepIp = (ip: string) => ip.startsWith('127.') || ip === '0.0.0.0' || ip === '::1' || ip === '::';

/** A real IPv6 address, not a clock time (12:30:45), a MAC address or a slice like a[1::2]. */
function isIpv6(m: string) {
  const groups = m.split(':').filter(Boolean);
  if (m.includes('::')) return m.split('::').length === 2 && (groups.length >= 3 || groups.some((g) => g.length === 4));
  return groups.length === 8;
}

// Passwords written out in prose ("the storefront password is x", "**Password:** `x`"): only the value goes.
const PASSWORD_PHRASE =
  /\b(pass(?:word|code|wd)|wachtwoord)\b(\**(?:[^\n.:=`]{0,40}?\s(?:is|was|=)\s+|\s*\**\s*[:=]\s*\**\s*|\s+(?=`)))(`[^`\n]{3,}`|"[^"\n]{3,}"|[^\s`"',;)]{3,})/gi;
/** Words that follow "password is" in prose without being the password. */
const NOT_A_PASSWORD = new Set(
  'now the a an in set stored saved not still also required correct wrong protected page field off on removed gone there here needed enabled disabled for from to and or so what which only being already changed rotated reset shared same different missing empty blank optional visible hidden known unknown'.split(' '),
);

/** Values of passwords spelled out in text. */
export function redactPasswords(input: string): string {
  return input.replace(PASSWORD_PHRASE, (m, word: string, between: string, value: string) => {
    const bare = value.replace(/^[`"]|[`"]$/g, '').replace(/[.!?]+$/, '');
    if (bare === '[REDACTED]' || NOT_A_PASSWORD.has(bare.toLowerCase())) return m;
    return `${word}${between}${value.startsWith('`') ? '`[REDACTED]`' : '[REDACTED]'}`;
  });
}

/** IP addresses and SSH details, replaced whole. URL hosts count; ids in URL paths are left to the other rules. */
export function redactNetwork(input: string): string {
  let s = input;
  for (const re of SSH_PATTERNS) s = s.replace(re, '[REDACTED]');
  s = s.replace(/^.*$/gm, (line) =>
    SSH_COMMAND.test(line)
      ? line
          .replace(/(\s-i\s+)(?!\[REDACTED\])[^\s'"`]+/g, '$1[REDACTED]')
          .replace(/(?<![\w.+-])[\w.+-]+@(?:\[[0-9A-Fa-f:.]+\]|[\w.-]+)/g, '[REDACTED]')
      : line,
  );
  s = s.replace(IPV4, (m) => (keepIp(m) ? m : '[REDACTED]'));
  s = s.replace(IPV6, (m) => (isIpv6(m) && !keepIp(m) ? '[REDACTED]' : m));
  return s;
}

/**
 * True when a match sits in a URL or file path (before any `?`), in a dotted key, or is a file name.
 * Doc, sheet and page ids and git SHAs live there; secrets go in query strings, headers and assignments.
 */
function inPathOrName(s: string, offset: number, length: number) {
  let start = offset;
  while (start > 0 && !/[\s"'`()<>\[\]]/.test(s[start - 1])) start--;
  const before = s.slice(start, offset);
  if (before.includes('/') && !/[?=&]/.test(before)) return true;
  if (s[offset - 1] === '.') return true;
  return /^\.[A-Za-z][A-Za-z0-9]{0,5}(?![A-Za-z0-9])/.test(s.slice(offset + length));
}

const entropy = (s: string) => {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
};

/** A long run of base64/url-safe characters mixing upper, lower and digits, random enough to be a key. */
const looksRandom = (s: string) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && entropy(s) >= 4;

/**
 * Builds the redactor: exact secret values first (longest first, so one value inside another goes whole),
 * then token shapes, `NAME_KEY=value` assignments, Bearer headers, passwords in URLs and prose, IP addresses and SSH details.
 */
export function makeRedactor(secretValues: Iterable<string>): (s: string) => string {
  const values = [...new Set([...secretValues].map((v) => v.trim()).filter((v) => v.length >= 6))].sort((a, b) => b.length - a.length);
  return (input: string) => {
    let s = input;
    for (const v of values) if (s.includes(v)) s = s.split(v).join('[REDACTED]');
    for (const re of TOKEN_PATTERNS) s = s.replace(re, '[REDACTED]');
    s = s.replace(/\b(Bearer|Basic|token)\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{16,}/g, '$1 [REDACTED]');
    s = s.replace(
      /\b([A-Z][A-Z0-9_]*)(\s*[=:]\s*["']?)(?!\[REDACTED\])([^\s"'`,;]{6,})/g,
      (m, name: string, sep: string) => (SECRET_NAME.test(name) ? `${name}${sep}[REDACTED]` : m),
    );
    s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})@/gi, '$1[REDACTED]@');
    // Long hex (API secrets, webhook keys) and long random-looking runs, unless they are an id in a path or a file name.
    s = s.replace(/\b[A-Fa-f0-9]{32,}\b/g, (m, at: number, str: string) => (inPathOrName(str, at, m.length) ? m : '[REDACTED]'));
    s = s.replace(/(?<![A-Za-z0-9+_-])[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9+=_-])/g, (m, at: number, str: string) =>
      looksRandom(m) && !inPathOrName(str, at, m.length) ? '[REDACTED]' : m,
    );
    return redactPasswords(redactNetwork(s));
  };
}

/** Values of env vars whose names look like secrets (the .env file and the Keychain secrets the server injects). */
export function envSecretValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([k, v]) => v && SECRET_NAME.test(k.toUpperCase()))
    .map(([, v]) => v as string);
}

// ---------- rendering ----------

const parse = (payload: string): Record<string, any> => {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
};

function when(iso: string, timezone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const dateOnly = (iso: string, timezone: string) => when(iso, timezone).slice(0, 10);

function head(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n\n[… ${text.length - max} more characters left out]`;
}

function tail(text: string, max: number) {
  if (text.length <= max) return text;
  return `[… ${text.length - max} earlier characters left out]\n\n${text.slice(-max).trimStart()}`;
}

/** Who wrote a user event. Briefs from the Conductor and team leads are labelled as such. */
function userLabel(p: Record<string, any>) {
  switch (p.source) {
    case 'conductor':
      return 'Task brief (from the Conductor)';
    case 'team':
      return 'Message from the team lead';
    case 'automation':
      return 'Automation prompt';
    default:
      return p.mode === 'steer' ? 'Ben (steering mid-turn)' : 'Ben';
  }
}

function userBody(p: Record<string, any>) {
  let text = String(p.text ?? '').trim();
  if (p.slash && !text.startsWith('/')) text = `/${p.slash} ${text}`.trim();
  const files = Array.isArray(p.attachments) ? p.attachments.map((a: any) => a?.name ?? a?.path ?? a).filter(Boolean) : [];
  if (files.length) text += `\n\n_Attached: ${files.map(String).join(', ')}_`;
  return text;
}

interface RenderContext {
  thread: ThreadRow;
  channel: Route;
  folder: string | null;
  artifacts: { name: string; url: string | null; description: string | null }[];
  children: { id: string; title: string; channel_id: string; role: string | null; task_id: string | null }[];
  parent: { id: string; title: string } | null;
  events: EventRow[];
  part: number;
  previousUid: string | null;
  timezone: string;
  /** A Conductor thread that delegated: Ben's own messages and what went where, nothing the Conductor wrote. */
  stub?: boolean;
}

/** YAML scalar: JSON strings are valid YAML and escape everything that matters. */
const y = (v: unknown) => (v == null || v === '' ? 'null' : typeof v === 'number' ? String(v) : JSON.stringify(String(v)));

/**
 * The digest body: Ben's messages and briefs in full, each turn's final reply in full, the working notes
 * before it cut to NOTES_MAX, crew reports cut to their tail. Tool calls, init and status never appear.
 * Returns null when nothing in `events` is worth a file.
 */
export function renderDigest(ctx: RenderContext, redact: (s: string) => string): string | null {
  const tz = ctx.timezone;
  const out: string[] = [];
  let content = 0;
  let notes: string[] = [];
  const agentTasks = new Set<string>();

  const flushNotes = (final: boolean) => {
    if (!notes.length) return;
    const last = final ? notes.pop()! : null;
    if (notes.length) out.push(`_Working notes:_\n\n${head(notes.join('\n\n'), NOTES_MAX)}`);
    if (last) out.push(`#### Reply\n\n${last}`);
    notes = [];
  };

  for (const e of ctx.events) {
    const p = parse(e.payload);
    if (ctx.stub) {
      const body = e.kind === 'user' && !['conductor', 'team', 'automation'].includes(p.source) ? userBody(p) : '';
      if (body) {
        out.push(`### ${userLabel(p)} · ${when(e.created_at, tz)}\n\n${body}`);
        content++;
      }
      continue;
    }
    switch (e.kind) {
      case 'user': {
        const body = userBody(p);
        if (!body) break;
        flushNotes(true);
        out.push(`### ${userLabel(p)} · ${when(e.created_at, tz)}\n\n${body}`);
        content++;
        break;
      }
      case 'assistant_text': {
        const text = String(p.text ?? '').trim();
        if (text) {
          notes.push(text);
          content++;
        }
        break;
      }
      case 'result': {
        flushNotes(true);
        const status = p.stopped ? 'stopped' : p.ok === false ? 'failed' : 'done';
        out.push(`_Turn ${status}._`);
        break;
      }
      case 'error': {
        const text = String(p.text ?? '').trim();
        if (text) out.push(`_Error: ${head(text, 300)}_`);
        break;
      }
      case 'crew_report': {
        flushNotes(true);
        const who = [p.role, p.channel ? `#${p.channel}` : null].filter(Boolean).join(', ');
        const title = p.title ? `"${p.title}"` : 'a crew thread';
        out.push(
          `### Crew report from ${title}${who ? ` (${who})` : ''} · ${p.status ?? 'done'} · ${when(e.created_at, tz)}\n\n` +
            `_Full digest: thread ${String(p.thread_id ?? '').slice(0, 8)}._\n\n${tail(String(p.text ?? '').trim(), CREW_REPORT_MAX)}`,
        );
        content++;
        break;
      }
      case 'task': {
        // Background bash tasks are commands (noise, and a secrets risk). Subagents carry a brief worth a line.
        if (p.task_type === 'local_agent' && p.event === 'started' && !agentTasks.has(p.task_id)) {
          agentTasks.add(p.task_id);
          out.push(`_Subagent${p.subagent_type ? ` (${p.subagent_type})` : ''}: ${String(p.description ?? '').trim()}_`);
        } else if (p.event === 'ended' && agentTasks.has(p.task_id) && p.summary) {
          out.push(`_Subagent finished (${p.status ?? 'done'}): ${head(String(p.summary).trim(), SUBAGENT_SUMMARY_MAX)}_`);
        }
        break;
      }
    }
  }
  flushNotes(true);
  if (ctx.stub && ctx.children.length) {
    out.push(
      `### Delegated\n\n${ctx.children
        .map((c) => `- "${c.title}": thread ${c.id}${c.task_id ? `, task ${c.task_id}` : ''}, #${c.channel_id}${c.role ? `, ${c.role}` : ''}`)
        .join('\n')}`,
    );
    content++;
  }
  if (!content) return null;

  const t = ctx.thread;
  const front = [
    '---',
    'source: omni',
    `digest: ${ctx.stub ? '"delegation-stub"' : '"thread"'}`,
    `thread_id: ${y(t.id)}`,
    `title: ${y(t.title)}`,
    `channel_id: ${y(ctx.channel.id)}`,
    `channel_name: ${y(ctx.channel.name)}`,
    `channel_kind: ${y(ctx.channel.kind)}`,
    ...(ctx.channel.project ? [`imported_project: ${y(ctx.channel.project)}`] : []),
    `folder: ${y(ctx.folder)}`,
    `role: ${y(t.role)}`,
    `task_id: ${y(t.task_id)}`,
    `parent_thread_id: ${y(t.parent_id)}`,
    `harness: ${y(t.harness)}`,
    `model: ${y(t.model)}`,
    `status: ${y(t.status)}`,
    `created: ${y(t.created_at)}`,
    `updated: ${y(t.updated_at)}`,
    `part: ${ctx.part}`,
    `previous_part_last_event_uid: ${y(ctx.previousUid)}`,
    `last_event_uid: ${y(ctx.events[ctx.events.length - 1].uid)}`,
    ctx.artifacts.length
      ? `artifacts:\n${ctx.artifacts
          .map((a) => `  - name: ${y(a.name)}\n    url: ${y(a.url)}${a.description ? `\n    description: ${y(a.description)}` : ''}`)
          .join('\n')}`
      : 'artifacts: []',
    '---',
  ];

  const about = [`Omni thread in #${ctx.channel.name} (${ctx.channel.kind}), started ${dateOnly(t.created_at, tz)}.`];
  if (ctx.parent) about.push(`Delegated from "${ctx.parent.title}" (${ctx.parent.id.slice(0, 8)}).`);
  if (ctx.stub) about.push('Conductor thread that delegated: only Ben\'s messages and the threads it handed work to; their digests carry the work.');
  else if (ctx.children.length)
    about.push(`Delegated to: ${ctx.children.map((c) => `"${c.title}" (#${c.channel_id}, ${c.id.slice(0, 8)})`).join('; ')}.`);
  if (ctx.part > 1) about.push(`Part ${ctx.part}: only what happened after the previous export.`);

  const heading = `# ${t.title}${ctx.part > 1 ? ` (part ${ctx.part})` : ''}`;
  return redact(`${front.join('\n')}\n\n${heading}\n\n${about.join(' ')}\n\n${out.join('\n\n')}\n`);
}

// ---------- planning ----------

export interface Route {
  id: string;
  name: string;
  kind: string;
  /** Imported history with no channel: the project folder it ran in, like moneybot. */
  project?: string;
  /** Imported history that ran in a temp dir, scratchpad or worktree: nothing for the brain. */
  scratch?: boolean;
}

/** Throwaway working dirs: temp dirs, scratchpads and agent worktrees. */
/**
 * Old project folders whose channel's repo now lives under another name, by folder name. Imported sessions
 * that ran in one go to that channel.
 */
export const IMPORTED_ALIASES: Record<string, string> = {
  coldblackcoffee: 'cold-black-coffee',
};

export const SCRATCH_CWD = /^\/(?:private\/)?(?:tmp|var\/folders)\/|\/scratchpad(?:\/|$)|\/scratch-workspaces\/|\/\.claude\/worktrees\/|\/data\/worktrees\//;

const lastSegment = (p: string) => p.replace(/\/+$/, '').split('/').pop()?.toLowerCase() ?? '';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';

/**
 * The channel a thread's digest goes to. Imported history has no real channel: route it by its cwd, then by a
 * repo with the same folder name (a checkout elsewhere) or an alias, else to imported/<folder name>.
 */
export function routeChannel(thread: ThreadRow, channels: ChannelRow[], home = ''): Route {
  const own = channels.find((c) => c.id === thread.channel_id);
  if (thread.channel_id !== IMPORTED.id && own) return own;
  const candidates = channels.filter((c) => c.id !== IMPORTED.id && !SKIP_CHANNELS.has(c.id));
  const match = matchChannel(thread.cwd, candidates);
  if (match) return match;
  if (SCRATCH_CWD.test(thread.cwd)) return { ...IMPORTED, scratch: true };
  const base = lastSegment(thread.cwd);
  const sameName =
    candidates.find((c) => [c.repo_path, c.base_dir].some((p) => p && lastSegment(p) === base)) ??
    candidates.find((c) => c.id === IMPORTED_ALIASES[base]);
  if (sameName) return sameName;
  const atHome = home && thread.cwd.replace(/\/+$/, '') === home.replace(/\/+$/, '');
  return { ...IMPORTED, ...(own ?? {}), project: atHome ? 'home' : slug(base) };
}

export const digestPath = (route: Route, createdAt: string, threadId: string, part: number, timezone: string) =>
  join('omni', route.id, route.project ?? '', `${dateOnly(createdAt, timezone)}-${threadId.slice(0, 8)}${part > 1 ? `-part${part}` : ''}.md`);

const THREAD_SQL = `SELECT id, channel_id, title, status, role, model, cwd, parent_id, task_id, source, harness, archived, folder_id,
  created_at, updated_at FROM threads`;

/** Every thread in scope with its digest or why it has none. Pure apart from reading `ro`. */
export function plan(ro: DatabaseSync, opts: PlanOptions): Planned[] {
  const tz = opts.timezone ?? 'Europe/Amsterdam';
  const channels = ro.prepare('SELECT id, name, kind, repo_path, base_dir FROM channels').all() as unknown as ChannelRow[];
  const threads = ro.prepare(`${THREAD_SQL} ORDER BY created_at, id`).all() as unknown as ThreadRow[];
  const byId = new Map(threads.map((t) => [t.id, t]));
  const kids = new Map<string, ThreadRow[]>();
  for (const t of threads) if (t.parent_id) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  const folders = new Map(
    (ro.prepare('SELECT id, parent_id, name FROM folders').all() as unknown as { id: string; parent_id: string | null; name: string }[]).map((f) => [f.id, f]),
  );
  const folderPath = (id: string | null) => {
    const names: string[] = [];
    for (let f = id ? folders.get(id) : undefined; f && names.length < 10; f = f.parent_id ? folders.get(f.parent_id) : undefined) names.unshift(f.name);
    return names.length ? names.join(' / ') : null;
  };

  const eventsAfter = ro.prepare('SELECT id, uid, kind, payload, created_at FROM events WHERE thread_id = ? AND id > ? ORDER BY id');
  const eventId = ro.prepare('SELECT id FROM events WHERE uid = ? AND thread_id = ?');
  const hasResult = ro.prepare(`SELECT 1 FROM events WHERE thread_id = ? AND kind IN ('result', 'crew_report') LIMIT 1`);
  const artifacts = ro.prepare('SELECT name, url, description FROM artifacts WHERE thread_id = ? ORDER BY created_at, id');

  const out: Planned[] = [];
  for (const t of threads) {
    const channel = routeChannel(t, channels, opts.home);
    if (opts.channel && channel.id !== opts.channel) continue;
    if (opts.since && t.updated_at < opts.since) continue;

    const skip = (reason: SkipReason) => out.push({ thread: t, skip: reason });
    if (SKIP_CHANNELS.has(t.channel_id)) {
      skip('test-channel');
      continue;
    }
    if (t.status === 'running' || t.status === 'queued') {
      skip('running');
      continue;
    }
    if (t.archived && !hasResult.get(t.id)) {
      skip('archived-noise');
      continue;
    }
    if (channel.scratch) {
      skip('scratch-cwd');
      continue;
    }
    // A Conductor thread that handed work out: the crew threads carry the substance, so it gets a stub.
    const stub = (t.role === 'conductor' || t.channel_id === 'conductor') && kids.has(t.id);

    const prev = opts.cursor.threads[t.id];
    let after = 0;
    if (prev) {
      const row = eventId.get(prev.uid, t.id) as { id: number } | undefined;
      if (!row) {
        skip('cursor-lost');
        continue;
      }
      after = row.id;
    }
    const events = eventsAfter.all(t.id, after) as unknown as EventRow[];
    if (!events.length) {
      skip('up-to-date');
      continue;
    }
    const part = prev ? prev.part + 1 : 1;
    const parent = t.parent_id ? byId.get(t.parent_id) : undefined;
    const content = renderDigest(
      {
        thread: t,
        channel,
        folder: folderPath(t.folder_id),
        artifacts: artifacts.all(t.id) as any,
        // A later part lists only the threads delegated since the previous export.
        children: (kids.get(t.id) ?? [])
          .filter((c) => !prev || c.created_at >= events[0].created_at)
          .map((c) => ({ id: c.id, title: c.title, channel_id: routeChannel(c, channels, opts.home).id, role: c.role, task_id: c.task_id })),
        parent: parent ? { id: parent.id, title: parent.title } : null,
        events,
        part,
        previousUid: prev?.uid ?? null,
        timezone: tz,
        stub,
      },
      opts.redact,
    );
    if (!content) {
      skip(prev ? 'up-to-date' : 'no-content');
      continue;
    }
    out.push({
      thread: t,
      digest: {
        threadId: t.id,
        channelId: channel.id,
        path: digestPath(channel, t.created_at, t.id, part, tz),
        content,
        part,
        lastUid: events[events.length - 1].uid,
      },
    });
  }
  return out;
}
