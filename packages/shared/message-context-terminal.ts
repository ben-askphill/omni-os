// The terminal_excerpt kind of message context: output Ben selected in a thread's Terminal tab. It is a snapshot of
// plain text, taken when he added it, with which shell it came from and when. The shell goes on and the scrollback
// scrolls away; the record does not change. Nothing in it is ever run: the text has no control characters, so no
// escape sequence survives into the record or the harness's message.
// apps/mac/OmniKit/Sources/OmniKit/TerminalExcerptContext.swift ports it.
import { ID_MAX, cutLabel, overLimit, type MessageContextKind, type Parsed } from './message-context.ts';

export interface TerminalExcerpt {
  /** The thread whose shell it was: one shell per thread. */
  thread: string;
  /** The shell's process id, which tells a restarted shell from the one Ben selected in. Null when the server had none open. */
  pid: number | null;
  /** The directory the shell was started in. A `cd` since is not known. */
  cwd: string;
  /** When Ben added it, as `Date.toISOString` writes it. */
  captured_at: string;
  /** Lines in `text`. Parse derives it. */
  lines: number;
  /** Plain text, lines joined with `\n`, no control characters. */
  text: string;
}

export const LINES_MAX = 200;
export const TEXT_MAX = 8_000;
export const CWD_MAX = 1_024;
const LABEL_TEXT_MAX = 60;

/**
 * A character the record never holds, other than `\n` and `\t`: C0 and C1 controls (so no escape sequence), the line
 * and paragraph separators, and the bidirectional overrides that make text read as something it is not.
 */
const FORBIDDEN_RANGES = [[0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]] as const;
const unit = (n: number) => `\\u{${n.toString(16)}}`;
export const FORBIDDEN_CLASS = `[${FORBIDDEN_RANGES.map(([a, b]) => `${unit(a)}-${unit(b)}`).join('')}]`;
const FORBIDDEN = new RegExp(FORBIDDEN_CLASS, 'u');
// Terminal escapes, longest first: OSC to its terminator, CSI to its final byte, then any other ESC pair.
// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-?]*[ -/]*[@-~]?|\u001b[ -/]*[0-~]?/g;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One line of text for a field that has no line breaks of its own. */
export function plain(v: unknown, at: string, max: number): Parsed<string> {
  if (typeof v !== 'string' || !v || overLimit(v, max)) return { ok: false, error: `${at} must be a string of 1 to ${max} characters` };
  if (FORBIDDEN.test(v) || v.includes('\n') || v.includes('\t')) return { ok: false, error: `${at} must be plain text on one line` };
  return { ok: true, value: v };
}

const validTime = (v: unknown): v is string => typeof v === 'string' && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

export const terminalExcerpt: MessageContextKind<TerminalExcerpt> = {
  kind: 'terminal_excerpt',
  v: 1,
  parse(body, v): Parsed<TerminalExcerpt> {
    if (v !== 1) return { ok: false, error: `terminal_excerpt has no version ${v}` };
    if (!isObj(body)) return { ok: false, error: 'not an object' };
    const thread = plain(body.thread, 'thread', ID_MAX);
    if (!thread.ok) return thread;
    const pid = body.pid === undefined || body.pid === null ? null : body.pid;
    if (pid !== null && (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1)) return { ok: false, error: 'pid must be a process id or null' };
    const cwd = plain(body.cwd, 'cwd', CWD_MAX);
    if (!cwd.ok) return cwd;
    if (!validTime(body.captured_at)) return { ok: false, error: 'captured_at must be a time like 2026-10-24T09:30:00.000Z' };
    const { text } = body;
    if (typeof text !== 'string') return { ok: false, error: 'text must be a string' };
    if (FORBIDDEN.test(text)) return { ok: false, error: 'text must be plain text: no control characters or escape sequences' };
    if (!/[^ \t\n]/.test(text)) return { ok: false, error: 'text is empty' };
    if (overLimit(text, TEXT_MAX)) return { ok: false, error: `text is longer than ${TEXT_MAX} characters` };
    const lines = text.split('\n').length;
    if (lines > LINES_MAX) return { ok: false, error: `text is longer than ${LINES_MAX} lines` };
    return { ok: true, value: { thread: thread.value, pid, cwd: cwd.value, captured_at: body.captured_at, lines, text } };
  },
  label(b) {
    const first = [...(b.text.split('\n').find((l) => /[^ \t]/.test(l)) ?? '').replace(/^[ \t]+|[ \t]+$/g, '').replace(/\t/g, ' ')];
    const head = first.length > LABEL_TEXT_MAX ? `${first.slice(0, LABEL_TEXT_MAX - 1).join('')}…` : first.join('');
    return cutLabel(`Terminal, ${b.lines === 1 ? '1 line' : `${b.lines} lines`}: ${head}`);
  },
};

/** What the shell's selection is attached to. */
export interface TerminalSource {
  thread: string;
  pid: number | null;
  cwd: string;
  at: Date;
}

/**
 * Selected terminal text as plain text: escape sequences dropped whole, other control characters dropped, line endings
 * made `\n`, trailing spaces trimmed and the blank lines around it removed. What is left is what the terminal showed.
 */
export function plainText(raw: string): string {
  const lines = raw
    .replace(ESCAPES, '')
    .replace(/\r\n?/g, '\n')
    .replace(new RegExp(FORBIDDEN_CLASS, 'gu'), '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n');
}

/**
 * The record body for what is selected in the terminal now. Refused when nothing is, or when it is more than a message
 * should carry: it is never cut, since a cut excerpt would not be the output Ben meant.
 */
export function selectExcerpt(raw: string | null | undefined, from: TerminalSource): Parsed<TerminalExcerpt> {
  const text = plainText(raw ?? '');
  if (!text) return { ok: false, error: 'Nothing is selected. Select some output first.' };
  if (text.split('\n').length > LINES_MAX) return { ok: false, error: `Select at most ${LINES_MAX} lines.` };
  if (overLimit(text, TEXT_MAX)) return { ok: false, error: `Select at most ${TEXT_MAX} characters.` };
  return terminalExcerpt.parse({ thread: from.thread, pid: from.pid, cwd: from.cwd, captured_at: from.at.toISOString(), text }, 1);
}
