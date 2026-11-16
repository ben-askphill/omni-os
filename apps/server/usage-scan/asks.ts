// The usage scan's input: what Ben asked his agents for, one ask per thread he started, from his own typed messages.
// Read-only and model-free. It takes the database as an argument, so scripts/repeated-asks.ts can run it against a
// read-only handle on a live data/omni.db without the server's connection, migrations or sync.
import type { DatabaseSync } from 'node:sqlite';
import { descendantsCte } from '../lineage.ts';

/** The crew role of a usage scan's own thread (crew/usage-scan.md). Its first message is Omni's report, not an ask. */
export const SCAN_ROLE = 'usage-scan';

/** Message sources that are Ben typing, as db/repos/events.ts recentCommands counts them. `import` is his own Claude Code sessions from before Omni. */
const BEN_MESSAGES = new Set(['manual', 'ben', 'capture', 'import']);
/** Threads Ben started. A `conductor` or `team` thread opens with a brief an agent wrote; an `automation` one with a schedule's prompt. */
const BEN_THREADS = new Set(['manual', 'capture', 'import']);

/** Context a harness injected into a message, not typed: Claude Code's reminders and command wrappers in imported sessions. */
const NOISE =
  /<system-reminder>[\s\S]*?<\/system-reminder>|<(local-)?command-[a-z-]+>[\s\S]*?<\/(local-)?command-[a-z-]+>|<environment_context>[\s\S]*?<\/environment_context>|<user_instructions>[\s\S]*?<\/user_instructions>/g;
/** Text another agent or an automation wrote, as Cloudroom's workflow scan spots it (extract.py AUTO). */
const AGENT_MARKERS = ['Loop note', '<webhook_events>', 'You are a subagent', 'This is an automated', 'automation run', '# AGENTS.md instructions', '<INSTRUCTIONS>'];
/** A slash command typed in the text: `/review`, not a path or a URL. */
const SLASH = /(?<![\w/])\/[a-z][a-z0-9-]{2,}(?![\w/.-])/g;

/** Fewer characters than this, and no command, says nothing about the task. */
const MIN_TEXT = 15;
/** A first message this long, sent in this many threads with the same start, was pasted from a template. */
const PASTED_CHARS = 300;
const PASTED_TIMES = 3;
/** The same first message again this soon is a fork or a resumed session of the same ask, not a new one. */
const DUPLICATE_MS = 86_400_000;

export interface Ask {
  thread_id: string;
  channel_id: string;
  role: string | null;
  harness: string;
  title: string;
  /** When Ben sent the thread's first message. */
  at: string;
  /** His first message, the task statement, with injected context removed. Not masked: mask before it reaches a model. */
  text: string;
  /** Slash commands and skill mentions in any of his messages in the thread, as `/name`. */
  commands: string[];
  /** How many messages he sent in the thread. */
  messages: number;
}

/** Why a thread with Ben's messages in it is not an ask. */
export type LeftOut = 'automation' | 'delegated' | 'scan' | 'opted_out' | 'agent_written' | 'short' | 'duplicate';

/** A long first message Ben sent in several threads with the same start: a prompt he keeps pasting. */
export interface Pasted {
  asks: Ask[];
}

export interface AskScan {
  days: number;
  since: string;
  /** Oldest first. Pasted prompts are not among them. */
  asks: Ask[];
  pasted: Pasted[];
  /** Threads with Ben's messages in the window that are not asks, by why. */
  left_out: Record<LeftOut, number>;
  /** Ben's messages in the asks' threads and the pasted ones. */
  messages: number;
  /** Channels set to "Leave out of usage scans". */
  opted_out: string[];
}

export interface ReadAsksOptions {
  days?: number;
  now?: Date;
  /** Only this channel's threads. */
  channel?: string | null;
}

interface Row {
  thread_id: string;
  created_at: string;
  payload: string;
  channel_id: string;
  role: string | null;
  harness: string;
  title: string;
  source: string;
  /** An automation run, or a thread that came from one (lineage.ts). */
  ran: number;
  /** A Conductor, team or other agent thread, or a thread that came from one. */
  agent: number;
}

interface Payload {
  text?: string;
  source?: string;
  dropped?: boolean;
  slash?: { command?: { name?: string }; mentions?: { name?: string }[] };
}

export const cleanText = (text: string) => text.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

const slashNames = (p: Payload) =>
  [p.slash?.command?.name, ...(p.slash?.mentions ?? []).map((m) => m.name)].filter((n): n is string => !!n).map((n) => `/${n.replace(/^\//, '')}`);

/** The start of a long first message, as the pasted-prompt check compares it. */
const pastedKey = (text: string) => text.slice(0, 200).toLowerCase().replace(/\W+/g, ' ').trim();

/**
 * Ben's asks over the last `days`: the first message he typed in each thread he started, with the slash commands he
 * used there. Left out: threads an automation started and every thread that came from one, threads the Conductor, a
 * team lead or another agent started and every thread that came from one (their first message is a brief an agent
 * wrote; a continued thread records it as Ben's), usage scan threads, channels that opted out, and
 * threads whose text an agent wrote or that say too little. A thread counts when its first message from Ben falls in
 * the window.
 */
export function readAsks(db: DatabaseSync, opts: ReadAsksOptions = {}): AskScan {
  const days = opts.days ?? 90;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  // A database from before the opt-out has no column for it: nothing opted out.
  const hasOptOut = db.prepare(`SELECT 1 FROM pragma_table_info('channels') WHERE name = 'scan_opt_out'`).get() !== undefined;
  const optedOut = hasOptOut ? (db.prepare('SELECT id FROM channels WHERE scan_opt_out = 1 ORDER BY id').all() as { id: string }[]).map((r) => r.id) : [];
  const skip = new Set(optedOut);
  const rows = db
    .prepare(
      `WITH RECURSIVE ${descendantsCte(db, 'ran', `SELECT id FROM threads WHERE automation IS NOT NULL OR source = 'automation'`)},
         ${descendantsCte(db, 'agent', `SELECT id FROM threads WHERE source NOT IN (${[...BEN_THREADS].map((x) => `'${x}'`).join(', ')})`)}
       SELECT e.thread_id, e.created_at, e.payload, t.channel_id, t.role, t.harness, t.title, t.source,
              t.id IN (SELECT id FROM ran) AS ran, t.id IN (SELECT id FROM agent) AS agent
       FROM events e JOIN threads t ON t.id = e.thread_id
       WHERE e.kind = 'user' AND e.thread_id IN (SELECT DISTINCT thread_id FROM events WHERE kind = 'user' AND created_at >= ?)
         ${opts.channel ? 'AND t.channel_id = ?' : ''}
       ORDER BY e.created_at, e.id`,
    )
    .all(since, ...(opts.channel ? [opts.channel] : [])) as unknown as Row[];

  const threads = new Map<string, { row: Row; msgs: { at: string; text: string; commands: string[] }[] }>();
  for (const row of rows) {
    let p: Payload;
    try {
      p = JSON.parse(row.payload) as Payload;
    } catch {
      continue;
    }
    if (!BEN_MESSAGES.has(p.source ?? '') || p.dropped) continue;
    const entry = threads.get(row.thread_id) ?? { row, msgs: [] };
    entry.msgs.push({ at: row.created_at, text: cleanText(p.text ?? ''), commands: slashNames(p) });
    threads.set(row.thread_id, entry);
  }

  const left_out: Record<LeftOut, number> = { automation: 0, delegated: 0, scan: 0, opted_out: 0, agent_written: 0, short: 0, duplicate: 0 };
  const kept: Ask[] = [];
  let messages = 0;
  for (const { row, msgs } of threads.values()) {
    if (msgs[0].at < since) continue;
    const why: LeftOut | null =
      row.ran || row.source === 'automation'
        ? 'automation'
        : !BEN_THREADS.has(row.source) || row.agent
          ? 'delegated'
          : row.role === SCAN_ROLE
            ? 'scan'
            : skip.has(row.channel_id)
              ? 'opted_out'
              : null;
    if (why) {
      left_out[why]++;
      continue;
    }
    const all = msgs.map((m) => m.text).join(' ');
    const head = all.slice(0, 3000);
    if (AGENT_MARKERS.some((m) => head.includes(m))) {
      left_out.agent_written++;
      continue;
    }
    const text = msgs[0].text;
    const commands = [...new Set([...msgs.flatMap((m) => m.commands), ...(text.slice(0, 300).toLowerCase().match(SLASH) ?? [])])];
    if (all.length < MIN_TEXT && !commands.length) {
      left_out.short++;
      continue;
    }
    messages += msgs.length;
    kept.push({ thread_id: row.thread_id, channel_id: row.channel_id, role: row.role, harness: row.harness, title: row.title, at: msgs[0].at, text, commands, messages: msgs.length });
  }

  kept.sort((a, b) => a.at.localeCompare(b.at));
  const seen = new Map<string, number>();
  const unique = kept.filter((a) => {
    const at = Date.parse(a.at);
    const before = seen.get(a.text);
    seen.set(a.text, at);
    if (before === undefined || at - before > DUPLICATE_MS) return true;
    left_out.duplicate++;
    messages -= a.messages;
    return false;
  });
  const byStart = new Map<string, Ask[]>();
  for (const a of unique) if (a.text.length >= PASTED_CHARS) byStart.set(pastedKey(a.text), [...(byStart.get(pastedKey(a.text)) ?? []), a]);
  const pasted = [...byStart.values()].filter((g) => g.length >= PASTED_TIMES).map((asks) => ({ asks }));
  const inPasted = new Set(pasted.flatMap((p) => p.asks.map((a) => a.thread_id)));
  return { days, since, asks: unique.filter((a) => !inPasted.has(a.thread_id)), pasted, left_out, messages, opted_out: optedOut };
}
