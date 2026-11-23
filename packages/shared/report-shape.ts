// A crew report as its card shows it, on desktop, the phone layout and the iOS app: the outcome first in a few lines,
// then each part the agent wrote under a heading as a section that folds, its pull requests as chips, and what it said
// while it worked (`notes`) folded last. Tables become stacked rows, so nothing squeezes into columns on a phone.
// It reads the report's Markdown, so it works the same for every harness and for reports saved before notes existed.

/**
 * A crew report as the server saves it: the `crew_report` event's payload, and the request row that carries it to the
 * parent (apps/server/runner/queue.ts reportToParent). A type, not an interface, so it passes as a JSON record.
 */
export type CrewReport = {
  /** The run's final message, or what Omni wrote in its place. */
  text: string;
  /** What the run said before its final message, oldest first. A report saved before notes existed has none. */
  notes?: string[];
  task_id: string | null;
  /** The thread that reported. */
  thread_id: string;
  title: string;
  /** The agent it ran as. */
  role: string | null;
  channel: string;
  status: string;
  /** A child that ran on a remote harness: which one, by id and by name. */
  harness?: string;
  harness_name?: string;
  remote?: true;
  /** The answer to a question asked from the parent (ask.ts); `quiet` when it was asked only to be shown. */
  ask?: true;
  quiet?: true;
  /** Shown on the parent's delegation card with no turn of its own (queue.ts showsInPlace). */
  shown?: true;
};

/** A report another machine sent (apps/server/run-on.ts) or a saved row, when it has what a parent reads. */
export const isCrewReport = (v: unknown): v is CrewReport =>
  !!v && typeof v === 'object' && typeof (v as CrewReport).text === 'string' && typeof (v as CrewReport).thread_id === 'string';

export interface ReportSection {
  /** A stable key for the section within its report, for folding state. */
  key: string;
  title: string;
  /** Markdown, its tables stacked. */
  body: string;
  /** Its top-level list items, for the count chip; null when it has none. */
  count: number | null;
}

export interface ReportPr {
  label: string;
  href: string;
}

export interface ReportShape {
  /** The outcome, in Markdown: what the agent wrote before its first heading, at most a few blocks. */
  lead: string;
  sections: ReportSection[];
  /** The pull requests the report links, once each, in the order it names them. */
  prs: ReportPr[];
  /** What the agent said while it worked, before its final message, oldest first. */
  notes: string[];
}

/** The lead keeps a second block only while it stays this short; the rest goes to a Details section. */
const LEAD_CHARS = 400;
/** A report from before notes were split off whose lead runs past this many blocks carries its narration in it. */
const LEGACY_LEAD_BLOCKS = 3;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
/** A line that is only bold text, the heading GPT models tend to write. */
const BOLD_HEADING = /^\s{0,3}\*\*([^*\n]{1,80}?)\*\*:?\s*$/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TOP_ITEM = /^(?:[-*+]|\d{1,3}[.)])\s+\S/;
const SUMMARY = /^(summary|outcome|result|tl;?dr|verdict|answer|status)\b/i;
const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;

/** Each line, with whether it sits inside a fenced code block (fence lines count as inside). */
function scan(text: string): { line: string; code: boolean }[] {
  const out: { line: string; code: boolean }[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line);
    if (fence) {
      out.push({ line, code: true });
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
    } else if (m) {
      fence = m[1];
      out.push({ line, code: true });
    } else out.push({ line, code: false });
  }
  return out;
}

/** Blocks separated by blank lines, a fenced block kept whole. */
function blocks(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const { line, code } of scan(md)) {
    if (!code && !line.trim()) {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/**
 * Pipe tables as lists: each row an item led by its first cell in bold, its other cells under it as `Header: value`.
 * A two-column row stays on one line.
 */
export function stackTables(md: string): string {
  const lines = scan(md);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { line, code } = lines[i];
    const next = lines[i + 1];
    if (code || !line.includes('|') || !next || next.code || !DELIMITER.test(next.line) || !next.line.includes('-')) {
      out.push(line);
      continue;
    }
    const head = cells(line);
    i += 1;
    while (i + 1 < lines.length && !lines[i + 1].code && lines[i + 1].line.includes('|') && lines[i + 1].line.trim()) {
      i += 1;
      const row = cells(lines[i].line);
      const first = row[0] ?? '';
      const rest = row.slice(1).map((v, j) => ({ h: head[j + 1] ?? '', v })).filter((c) => c.v);
      const lead = first ? `**${first.replace(/^\*\*(.*)\*\*$/, '$1')}**` : '';
      if (rest.length <= 1) {
        const tail = rest[0] ? (lead ? `: ${rest[0].v}` : rest[0].v) : '';
        out.push(`- ${lead}${tail}`);
      } else {
        out.push(`- ${lead || rest[0].v}`);
        for (const c of lead ? rest : rest.slice(1)) out.push(`  - ${c.h ? `${c.h}: ` : ''}${c.v}`);
      }
    }
  }
  return out.join('\n');
}

function countItems(md: string): number | null {
  const n = scan(md).filter(({ line, code }) => !code && TOP_ITEM.test(line)).length;
  return n || null;
}

/** The pull requests a report links, once each. Named by repository only when it links more than one. */
export function reportPrs(text: string): ReportPr[] {
  const found: { repo: string; n: string; href: string }[] = [];
  for (const m of text.matchAll(PR_URL)) {
    if (!found.some((f) => f.href === m[0])) found.push({ repo: `${m[1]}/${m[2]}`, n: m[3], href: m[0] });
  }
  const many = new Set(found.map((f) => f.repo)).size > 1;
  return found.map((f) => ({ href: f.href, label: many ? `${f.repo.split('/')[1]} #${f.n}` : `PR #${f.n}` }));
}

interface Part {
  title: string | null;
  lines: string[];
}

/** The text split at its section headings: the shallowest level it uses, or bold-only lines when it has no headings. */
function parts(text: string): Part[] {
  const lines = scan(text);
  const levels = lines.flatMap(({ line, code }) => {
    const m = !code && HEADING.exec(line);
    return m ? [m[1].length] : [];
  });
  let level = levels.length ? Math.min(...levels) : 0;
  // One title heading over the rest: split at the level under it.
  if (level && levels.filter((l) => l === level).length === 1 && levels.some((l) => l > level) && levels[0] === level) {
    level = Math.min(...levels.filter((l) => l > level));
  }
  const headingOf = (line: string): string | null => {
    if (level) {
      const m = HEADING.exec(line);
      return m && m[1].length === level ? m[2].replace(/^\*\*(.*)\*\*$/, '$1').replace(/:$/, '').trim() : null;
    }
    const b = BOLD_HEADING.exec(line);
    return b ? b[1].replace(/:$/, '').trim() : null;
  };
  const out: Part[] = [{ title: null, lines: [] }];
  for (const { line, code } of lines) {
    const title = code ? null : headingOf(line);
    // A title heading above the split level reads as part of the lead.
    const above = !code && level && !title && HEADING.exec(line);
    if (title) out.push({ title, lines: [] });
    else if (above && out.length === 1 && !out[0].lines.some((l) => l.trim())) continue;
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

/**
 * The report card's view of a report. `notes` are the agent's messages before its final one (the server splits them
 * off, apps/server/runner/queue.ts); a report saved before that has none, and when its lead runs long the narration
 * is in it: every block but the last goes to the notes.
 */
export function reportShape(text: string, notes?: readonly string[]): ReportShape {
  const [head, ...rest] = parts(text.trim());
  const sections: ReportSection[] = [];
  const used = new Map<string, number>();
  const add = (title: string, md: string) => {
    const body = stackTables(md.trim());
    if (!body) return;
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    sections.push({ key: n > 1 ? `${base}-${n}` : base, title, body, count: countItems(body) });
  };

  let leadBlocks = blocks(head.lines.join('\n').trim());
  let earlier: string[] = (notes ?? []).map((n) => n.trim()).filter(Boolean);
  if (!notes && leadBlocks.length > LEGACY_LEAD_BLOCKS) {
    earlier = leadBlocks.slice(0, -1);
    leadBlocks = leadBlocks.slice(-1);
  }
  // A Summary (or Outcome, TL;DR) section first, with nothing above it, is the lead.
  if (!leadBlocks.length && rest[0]?.title && SUMMARY.test(rest[0].title)) leadBlocks = blocks(rest.shift()!.lines.join('\n').trim());
  const keep = leadBlocks.length > 1 && leadBlocks[0].length + leadBlocks[1].length <= LEAD_CHARS ? 2 : 1;
  if (leadBlocks.length > keep) add('Details', leadBlocks.slice(keep).join('\n\n'));
  leadBlocks = leadBlocks.slice(0, keep);
  for (const p of rest) add(p.title ?? 'Details', p.lines.join('\n'));
  return { lead: stackTables(leadBlocks.join('\n\n')), sections, prs: reportPrs(text), notes: earlier };
}
