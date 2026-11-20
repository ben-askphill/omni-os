// The composer's `@` menu as pure functions: the file being typed at the caret, and what picking a
// row does to the text. Which files exist is the server's to say (apps/server/mentions.ts). In a thread that can
// delegate, the synced machines are listed (apps/server/machine-pick.ts): picking one also adds a machine_mention
// record to the message (message-context-machine.ts). In a thread the menu also lists agents (members.ts): picking one
// adds an agent_mention record (message-context-agent.ts), and the message goes to that agent. The menu shows them in
// tabs, Machines | Agents | Files, and opens on Agents (ADR 0019).
import type { Reachability } from './handoff.ts';

/** The `@name` being typed, with the caret in it. `end` is where the name ends. */
export interface FileQuery {
  query: string;
  /** Where the `@` is. */
  start: number;
  end: number;
}

/** What `/api/mentions` lists for a row. */
export interface FileMention {
  /** What goes after the `@`: `artifacts/report.html` for a thread's artifact, a repo-relative path otherwise, a machine's name. */
  insert: string;
  /** The file's own name, shown bold. */
  name: string;
  /** Where it lives, shown quiet: the thread, or the folder inside the repo. For a machine, whether it is up. */
  detail: string;
  /** `agent`: an agent to send the message to, listed by the client (agentRows), never by the server. */
  kind: 'artifact' | 'file' | 'agent' | 'machine';
  /** A machine row's machine. */
  machine?: MentionedMachine;
}

/** A synced machine as the `@` menu lists it. */
export interface MentionedMachine {
  id: string;
  here: boolean;
  reachability: Reachability;
  lastSeen: string | null;
}

/** The `@` menu's tabs, in Ben's order (Q11). The menu opens on Agents; a tab with nothing in it does not show. */
export type MentionTab = 'machines' | 'agents' | 'files';
export const MENTION_TABS: readonly { id: MentionTab; label: string }[] = [
  { id: 'machines', label: 'Machines' },
  { id: 'agents', label: 'Agents' },
  { id: 'files', label: 'Files' },
];
export const tabOf = (r: Pick<FileMention, 'kind'>): MentionTab => (r.kind === 'machine' ? 'machines' : r.kind === 'agent' ? 'agents' : 'files');

/** The tabs with rows in them, and the one to show: `want` if it has rows, else Agents, else the first that has any. */
export function mentionTabs(rows: readonly Pick<FileMention, 'kind'>[], want: MentionTab | null): { tabs: MentionTab[]; open: MentionTab | null } {
  const tabs = MENTION_TABS.map((t) => t.id).filter((t) => rows.some((r) => tabOf(r) === t));
  const open = want && tabs.includes(want) ? want : tabs.includes('agents') ? 'agents' : (tabs[0] ?? null);
  return { tabs, open };
}

/** An agent the `@` menu offers: the thread's members first (the lead among them), then the agents a mention would seat. */
export interface MentionAgent {
  id: string;
  name: string;
}

/** The agent rows for `query`: an id or a word of the name that starts with it, members first, each once. */
export function agentRows(members: readonly MentionAgent[], others: readonly MentionAgent[], query: string): FileMention[] {
  const q = query.toLowerCase();
  const hit = (a: MentionAgent) => !q || a.id.startsWith(q) || a.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q));
  const seen = new Set<string>();
  const row = (a: MentionAgent, detail: string): FileMention[] => (seen.has(a.id) || !hit(a) ? [] : (seen.add(a.id), [{ insert: a.id, name: a.name, detail, kind: 'agent' }]));
  return [...members.flatMap((a) => row(a, 'In this thread')), ...[...others].sort((a, b) => a.name.localeCompare(b.name)).flatMap((a) => row(a, 'Joins this thread'))];
}

const TYPING = /(?<![\w@/.-])@([A-Za-z0-9._\-/]*)$/;
const NAME_REST = /^[A-Za-z0-9._\-/]*/;

/** The mention being typed at the caret: an `@` that starts a word, and the path characters after it. */
export function fileQuery(text: string, caret: number): FileQuery | null {
  const m = TYPING.exec(text.slice(0, caret));
  if (!m) return null;
  const end = caret + NAME_REST.exec(text.slice(caret))![0].length;
  // Anything else glued on makes it an address or prose.
  if (end < text.length && !/\s/.test(text[end])) return null;
  return { query: m[1], start: m.index, end };
}

/** The text after picking a file: `@path ` in place of what was typed, with the caret after the space. */
export function pickFile(text: string, at: FileQuery, insert: string): { text: string; caret: number } {
  const after = text.slice(at.end);
  const put = `@${insert}${/^[ \t]/.test(after) ? '' : ' '}`;
  return { text: text.slice(0, at.start) + put + after, caret: at.start + insert.length + 2 };
}

/** The `@path` tokens in a message: the path as typed, without the `@` or trailing punctuation. */
export function mentionTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w@/.-])@([A-Za-z0-9._\-/]+)/g)) {
    const path = m[1].replace(/[.\-/]+$/, '');
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}
