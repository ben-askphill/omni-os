// Ask from a thread (docs/plans/2026-11-18-connect-an-agent.md, C2): Ben asks a crew role a question from the thread
// he is in. Omni never seats a second agent in a thread: the Ask is a child thread on that role, and its answer comes
// back here as a crew report that wakes this thread's agent or, with "Just show it", only shows (decision F4). A
// message that starts with `@<role>` is an Ask (decision F11), and the composer says so with the Ask chip before it
// goes. The same rules for every client. Pure.
import { isRemoteHarnessId } from './custom-harness.ts';

/** A crew role an Ask can go to, as the `@` menu, the Ask chip and the Ask sheet show it. */
export interface AskRole {
  id: string;
  name: string;
  /** The harness it runs on, when known: the role's own here, the resolved run's in a preview. Null is Auto, never remote. */
  harness: string | null;
  /** It runs on a server outside Omni: its answer is data from there, and the channel may hold excerpts back. */
  remote: boolean;
}

/** What a client knows of a crew role (GET /api/crew). */
interface RoleLike {
  id: string;
  name: string;
  harness?: string | null;
  delegatable: boolean;
  delegateOnly: boolean;
  hidden: boolean;
}

/**
 * The roles Ben can ask from a thread: the ones a delegation may go to (so never the Conductor or a usage scan), shown
 * on this machine, and not ones that only route work. The thread's own role is left out: it is already here.
 */
export function askableRoles(roles: readonly RoleLike[], ownRole?: string | null): AskRole[] {
  return roles
    .filter((r) => r.delegatable && !r.delegateOnly && !r.hidden && r.id !== ownRole)
    .map((r) => ({ id: r.id, name: r.name, harness: r.harness ?? null, remote: isRemoteHarnessId(r.harness) }));
}

/** Roles for the `@` menu while `query` is typed: an id or a word of the name that starts with it, remote ones first. */
export function roleRows(roles: readonly AskRole[], query: string): AskRole[] {
  const q = query.toLowerCase();
  const hit = (r: AskRole) => !q || r.id.startsWith(q) || r.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q));
  return roles.filter(hit).sort((a, b) => Number(b.remote) - Number(a.remote) || a.name.localeCompare(b.name));
}

/** A message read as an Ask: the role it starts with, and the question after it. */
export interface AskDraft {
  role: AskRole;
  question: string;
}

/**
 * The Ask a message is, or null: it starts with `@<role id>` (case aside) and a role Ben can ask has that id. The
 * question is everything after it, and may still be empty while Ben types.
 */
export function askOf(text: string, roles: readonly AskRole[]): AskDraft | null {
  const m = /^\s*@([A-Za-z0-9][A-Za-z0-9-]*)(?=\s|$)([\s\S]*)$/.exec(text);
  if (!m) return null;
  const role = roles.find((r) => r.id === m[1].toLowerCase());
  return role ? { role, question: m[2].trim() } : null;
}

/** The chip over the composer once a message is an Ask: who it goes to, and that it runs elsewhere. */
export const askLabel = (role: Pick<AskRole, 'name' | 'remote'>) => `Ask ${role.name}${role.remote ? ' (remote)' : ''}`;

/** What GET /api/threads/:id/ask-preview answers: the excerpt an Ask from that thread would carry. */
export interface AskPreview {
  role: AskRole & { harnessName: string };
  excerpt: AskExcerpt;
}

export interface AskExcerpt {
  /** False: none goes, whatever Ben picks. `reason` says why. */
  allowed: boolean;
  reason?: string;
  /** Messages kept of the thread's `total`, and the characters they take. */
  entries: number;
  total: number;
  chars: number;
  /** The excerpt as the asked agent reads it, secret values masked. Empty when not `allowed`. */
  text: string;
}

/** The excerpt in a few words, as the chip says it: "last 12 of 40 messages, 3.1k characters". */
export function excerptSize(e: Pick<AskExcerpt, 'entries' | 'total' | 'chars'>): string {
  const chars = e.chars >= 1000 ? `${(e.chars / 1000).toFixed(1)}k` : String(e.chars);
  const which = e.entries === e.total ? `all ${e.total}` : `last ${e.entries} of ${e.total}`;
  return `${which} ${e.total === 1 ? 'message' : 'messages'}, ${chars} characters`;
}

/** POST /api/threads/:id/ask. */
export interface AskRequest {
  role: string;
  question: string;
  /** Send the thread excerpt along. Refused for a remote role in a channel that sends none. */
  excerpt: boolean;
  /** The answer wakes this thread's agent (default), or only shows here ("Just show it"). */
  wake: boolean;
  /** A retry's id, so a lost answer does not start a second Ask. */
  request_id?: string;
}

/**
 * The `ask` event in the asking thread: Ben's question and where it went. Clients show it with the Ask's live state,
 * and the report on it once it answers.
 */
export interface AskP {
  /** The Ask's own thread. */
  thread_id: string;
  role: string;
  /** The role's name when Ben asked. */
  name: string;
  harness: string;
  harness_name: string;
  remote: boolean;
  question: string;
  /** What went along of this thread, or null when no excerpt did. */
  excerpt: { entries: number; total: number; chars: number } | null;
  wake: boolean;
  title: string;
  channel: string;
}

/** The line over a sent Ask's question: who it went to, what went along, and what the answer does here. */
export function askCaption(p: Pick<AskP, 'name' | 'remote' | 'excerpt' | 'wake'>): string {
  const along = p.excerpt ? `with ${p.excerpt.entries} ${p.excerpt.entries === 1 ? 'message' : 'messages'} of this thread` : 'no thread excerpt';
  return [askLabel(p).replace(/^Ask /, 'Asked '), along, p.wake ? 'the answer wakes this thread' : 'the answer only shows here'].join(' · ');
}

/** What POST /api/threads/:id/ask answers. */
export interface AskSent {
  thread_id: string;
  ask: AskP;
}
