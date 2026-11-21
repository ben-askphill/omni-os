// Settings > Crew, as every client draws it: a role's chips and run line in the list, the editor's form and what a
// save sends, and the line diff Compare shows. The server's /api/crew (apps/server/crew-api.ts) is the contract.

import type { Memory, RoleMemoryMode, RoleMemoryWrites } from './memory.ts';

/** A crew role as GET /api/crew lists it: the fields Settings reads. */
export interface CrewListed {
  id: string;
  name: string;
  description: string;
  /** `image`: the URL of the image Ben uploaded (GET /api/crew/:id/avatar). Without one, the icon on its color. */
  avatar?: { image?: string; icon?: string; bg?: string };
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  mcp: string[];
  /** full, no-edits (no file-edit tools, shell kept) or delegate-only. Missing from a server before no-edits: read it with crewTools. */
  tools?: CrewTools;
  delegateOnly: boolean;
  delegatable: boolean;
  review: boolean;
  /** Whether its threads read its lessons and propose new ones. Missing from a server before role memory: read-write. */
  memory?: RoleMemoryMode;
  /** Whether a lesson its threads propose waits for the user. Missing from a server before role memory: review. */
  memoryWrites?: RoleMemoryWrites;
  /** How many lessons its threads proposed wait for the user, when any do. */
  memoryWaiting?: number;
  /** The skills its threads load when they start (agent-skills.ts). Missing from a server before skills: none. */
  skills?: string[];
  kind: 'shipped' | 'edited' | 'own';
  hidden: boolean;
  charterMode?: 'append' | 'replace';
  builtInChanged?: boolean;
  locks?: CrewLocks;
  error?: string;
}

export type CrewTools = 'full' | 'no-edits' | 'delegate-only';

/** A role's tools, from a server that sends `tools` or an older one that sends only `delegateOnly`. */
export const crewTools = (r: Pick<CrewListed, 'tools' | 'delegateOnly'>): CrewTools => r.tools ?? (r.delegateOnly ? 'delegate-only' : 'full');

/**
 * What no-edits takes away on each harness, for Settings to say. It is not read only: the shell stays everywhere it
 * can be kept, so a command can still change a file.
 */
export const NO_EDITS_NOTE =
  'Takes the file-edit tools away: Edit, Write and NotebookEdit on Claude Code, file patches on Codex, file writes on Cursor. The shell stays for gh and checks, so this is not read only: a command can still change files. Hermes and Cursor Cloud get it as an instruction only.';

/** A key a save may not change on a built-in Omni relies on. `charter_mode` locked: the charter may only be added to. */
export type CrewLockedField = 'delegate_only' | 'mcp' | 'delegatable' | 'review' | 'charter_mode';

/** What keeps a built-in Omni relies on working (apps/server/crew.ts CREW_LOCKS), each with why, for Settings to show. */
export interface CrewLocks {
  fields?: Partial<Record<CrewLockedField, string>>;
  actions?: Partial<Record<'duplicate' | 'hide', string>>;
}

/** GET /api/crew/:id: the role, the built-in alone, and the two charters as written (placeholders kept). */
export interface CrewDetailView<R extends CrewListed = CrewListed> {
  role: R;
  /** The shipped role without the user's overlay, or null for a role of the user's own. */
  builtIn: R | null;
  /** The shipped file, or null for a role of the user's own. */
  shipped: string | null;
  /** The user's file: their role, or their overlay on the built-in. */
  own: string | null;
  shippedHash: string | null;
  charters: {
    /** The shipped charter, as written. */
    builtIn: string | null;
    /** The user's file's body: their whole charter, or what their overlay adds to or puts in place of the built-in's. */
    own: string | null;
    /** The charter the role runs with, as written: the built-in's with the additions, the replacement, or their own. */
    effective: string;
  };
}

export type CrewChipTone = 'default' | 'outline' | 'needs';

export interface CrewChip {
  label: string;
  tone: CrewChipTone;
  /** What the chip means, for its tooltip. */
  title: string;
}

/** The chips a role's row shows: where it comes from, then whatever needs a look. */
export function crewChips(r: Pick<CrewListed, 'kind' | 'hidden' | 'builtInChanged' | 'error' | 'charterMode' | 'memoryWaiting'>): CrewChip[] {
  const chips: CrewChip[] = [];
  if (r.kind === 'shipped') chips.push({ label: 'Built-in', tone: 'outline', title: 'Shipped with Omni. Each release can update it.' });
  else if (r.kind === 'edited')
    chips.push({
      label: 'Edited',
      tone: 'default',
      title: r.charterMode === 'append' ? 'A built-in with your edits. Your text is added to its charter, so release fixes still reach it.' : 'A built-in with your edits. Your charter replaces the built-in one.',
    });
  else chips.push({ label: 'Yours', tone: 'default', title: 'An agent of your own, in data/crew/.' });
  if (r.hidden) chips.push({ label: 'Hidden', tone: 'outline', title: 'Hidden on this machine: no new thread starts as it.' });
  if (r.builtInChanged) chips.push({ label: 'Built-in charter changed', tone: 'default', title: 'Your charter replaces a built-in one that changed since. Compare to see what you are missing.' });
  if (r.error) chips.push({ label: "Can't run here", tone: 'needs', title: r.error });
  if (r.memoryWaiting)
    chips.push({ label: `${r.memoryWaiting} ${r.memoryWaiting === 1 ? 'lesson waits' : 'lessons wait'}`, tone: 'needs', title: 'Its threads proposed lessons for its memory. Open the agent to approve or dismiss them.' });
  return chips;
}

/** The run a role defaults to, in one line: Auto, or the harness and model with its effort. */
export function crewRunLine(r: Pick<CrewListed, 'harness' | 'model' | 'effort'>, names: { harness?: (id: string) => string | undefined; model?: (harness: string, id: string) => string | undefined } = {}): string {
  if (!r.harness && !r.model && !r.effort) return 'Auto, or the channel default';
  if (!r.harness && (r.model === 'auto' || !r.model)) return 'Auto';
  const harness = r.harness ?? 'claude-code';
  const parts = [names.harness?.(harness) ?? harness, r.model ? (names.model?.(harness, r.model) ?? r.model) : 'its default model', r.effort];
  return parts.filter(Boolean).join(' · ');
}

/** A new role's id from its name: lowercase words and dashes, as the server takes it (CREW_ID). */
export function crewIdFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

export const CREW_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The editor's form. Run fields follow the composer's pickers: an empty harness and `auto` model is Auto. */
export interface CrewDraft {
  name: string;
  description: string;
  icon: string;
  bg: string;
  harness: string;
  model: string;
  effort: string;
  channel: string;
  delegateOnly: boolean;
  /** No file-edit tools (`tools: no-edits`). Moot while delegateOnly is on, which takes more away. */
  noEdits: boolean;
  delegatable: boolean;
  conductorTools: boolean;
  review: boolean;
  memory: RoleMemoryMode;
  memoryWrites: RoleMemoryWrites;
  /** The skills its threads load when they start, in the order ticked. */
  skills: string[];
  /** For a built-in: the text added to or put in place of its charter. For a role of the user's own: the whole charter. */
  charter: string;
  charterMode: 'append' | 'replace';
}

const fieldsOf = (r: CrewListed) => ({
  name: r.name,
  description: r.description,
  icon: r.avatar?.icon ?? '',
  bg: r.avatar?.bg ?? '',
  harness: r.harness ?? '',
  model: r.model ?? '',
  effort: r.effort ?? '',
  channel: r.channel ?? '',
  delegateOnly: r.delegateOnly,
  noEdits: r.tools === 'no-edits',
  delegatable: r.delegatable,
  conductorTools: r.mcp.includes('omni'),
  review: r.review,
  memory: r.memory ?? 'read-write',
  memoryWrites: r.memoryWrites ?? 'review',
  skills: r.skills ?? [],
});

/** The form for a role as it stands. A built-in no one edited adds to its charter until the user picks Replace. */
export function crewDraftOf(d: CrewDetailView): CrewDraft {
  return { ...fieldsOf(d.role), charter: d.charters.own ?? '', charterMode: d.role.charterMode ?? 'append' };
}

/** A blank role of the user's own. */
export function blankCrewDraft(): CrewDraft {
  return { name: '', description: '', icon: '', bg: '', harness: '', model: 'auto', effort: '', channel: '', delegateOnly: false, noEdits: false, delegatable: true, conductorTools: false, review: false, memory: 'read-write', memoryWrites: 'review', skills: [], charter: '', charterMode: 'replace' };
}

/** Why the form cannot be saved yet, or null. */
export function crewDraftProblem(d: CrewDraft, id?: string): string | null {
  if (!d.name.trim()) return 'Give the agent a name.';
  if (id !== undefined && !CREW_ID_PATTERN.test(id)) return 'The id takes lowercase letters, digits and dashes.';
  if (d.delegateOnly && !d.conductorTools) return 'An agent that only routes work needs the conductor tools to hand it on.';
  return null;
}

type FieldKey = keyof ReturnType<typeof fieldsOf>;

export interface CrewSaveBody {
  fields: Record<string, unknown>;
  charter?: string;
  charter_mode?: 'append' | 'replace';
}

/**
 * What a save sends (PUT /api/crew/:id, or POST /api/crew with an id). On a built-in, a field set back to the built-in's
 * value is sent empty (null for a list or a switch), so the overlay drops it and later releases set it; a field the form
 * left alone is not sent at all. On a role of the user's own, every field is sent and an empty one removes its key.
 * The charter and its mode go only when they changed: the server reads either as "written against today's built-in"
 * (`based_on`), so sending them with a description edit would clear "Built-in charter changed" unseen.
 */
export function crewSaveBody(d: CrewDraft, detail: CrewDetailView | null): CrewSaveBody {
  const now = fieldsOf(fromDraft(d, detail?.role));
  const before = detail ? fieldsOf(detail.role) : null;
  const builtIn = detail?.builtIn ? fieldsOf(detail.builtIn) : null;
  const fields: Record<string, unknown> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of Object.keys(now) as FieldKey[]) {
    if (k === 'icon' || k === 'bg') continue;
    if (before && same(now[k], before[k])) continue;
    const key = WIRE[k];
    const value = k === 'conductorTools' ? (now[k] ? ['omni'] : []) : k === 'noEdits' ? (now[k] ? 'no-edits' : 'full') : now[k];
    // Back to the built-in's value: an empty string or null takes the key out of the overlay. A role of the user's own
    // leaves a switch at its default out of the file the same way.
    const unset = builtIn ? same(now[k], builtIn[k]) : k in SWITCH_DEFAULTS && now[k] === SWITCH_DEFAULTS[k as keyof typeof SWITCH_DEFAULTS];
    fields[key] = unset ? (typeof value === 'string' ? '' : null) : value;
  }
  // The avatar's icon and color go together, a cleared one as null: a save changes only the avatar keys it names, so
  // an uploaded image (PUT /api/crew/:id/avatar) stays. Null for both drops them.
  if (!before || before.icon !== now.icon || before.bg !== now.bg) {
    fields.avatar = now.icon || now.bg ? { icon: now.icon || null, bg: now.bg || null } : null;
  }
  const body: CrewSaveBody = { fields };
  if (!detail || d.charter.trim() !== (detail.charters.own ?? '').trim()) body.charter = d.charter;
  if (detail?.builtIn && d.charterMode !== (detail.role.charterMode ?? 'append')) body.charter_mode = d.charterMode;
  return body;
}

/** What a role is when its file leaves a switch out (apps/server/crew.ts). */
const SWITCH_DEFAULTS = { delegateOnly: false, noEdits: false, delegatable: true, review: false, memory: 'read-write', memoryWrites: 'review' } as const;

const WIRE: Record<FieldKey, string> = {
  name: 'name',
  description: 'description',
  icon: 'avatar',
  bg: 'avatar',
  harness: 'harness',
  model: 'model',
  effort: 'effort',
  channel: 'channel',
  delegateOnly: 'delegate_only',
  noEdits: 'tools',
  delegatable: 'delegatable',
  conductorTools: 'mcp',
  review: 'review',
  memory: 'memory',
  memoryWrites: 'memory_writes',
  skills: 'skills',
};

/** The draft read back as a listed role, so a save compares like with like. */
function fromDraft(d: CrewDraft, base: CrewListed | undefined): CrewListed {
  const mcp = (base?.mcp ?? []).filter((s) => s !== 'omni');
  return {
    id: base?.id ?? '',
    name: d.name.trim(),
    description: d.description.trim(),
    avatar: d.icon || d.bg ? { ...(d.icon && { icon: d.icon }), ...(d.bg && { bg: d.bg }) } : undefined,
    harness: d.harness || undefined,
    model: d.model || undefined,
    effort: d.effort || undefined,
    channel: d.channel || undefined,
    mcp: d.conductorTools ? ['omni', ...mcp] : mcp,
    tools: d.delegateOnly ? 'delegate-only' : d.noEdits ? 'no-edits' : 'full',
    delegateOnly: d.delegateOnly,
    delegatable: d.delegatable,
    review: d.review,
    memory: d.memory,
    memoryWrites: d.memoryWrites,
    skills: d.skills,
    kind: base?.kind ?? 'own',
    hidden: base?.hidden ?? false,
  };
}

/** A role's markdown in the editor's Markdown tab: the user's file, or a fresh overlay for a built-in no one edited. */
export function crewMarkdownOf(d: CrewDetailView | null): string {
  if (d?.own) return d.own;
  if (d?.builtIn) return '---\ncharter_mode: append\n---\n';
  return '---\nname: \ndescription: \nmodel: auto\n---\n';
}

export type DiffRowKind = 'same' | 'add' | 'del';

export interface CrewDiffRow {
  kind: DiffRowKind;
  text: string;
}

/** Longest-common-subsequence line diff, old to new. Charters are short, so the table is small. */
export function lineDiff(before: string, after: string): CrewDiffRow[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const rows: CrewDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) rows.push({ kind: 'same', text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) rows.push({ kind: 'del', text: a[i++] });
    else rows.push({ kind: 'add', text: b[j++] });
  }
  while (i < n) rows.push({ kind: 'del', text: a[i++] });
  while (j < m) rows.push({ kind: 'add', text: b[j++] });
  return rows;
}

/**
 * The three ways out of "Built-in charter changed" (plan section 2.3), as the saves they make: keep the replacement
 * and record the new built-in as seen, take the built-in's charter, or keep the text as an addition to it.
 */
export const CHANGED_CHARTER_ACTIONS = {
  keep: (own: string): Pick<CrewSaveBody, 'charter' | 'charter_mode'> => ({ charter: own, charter_mode: 'replace' }),
  takeBuiltIn: (): Pick<CrewSaveBody, 'charter' | 'charter_mode'> => ({ charter: '', charter_mode: 'append' }),
  addMine: (own: string): Pick<CrewSaveBody, 'charter' | 'charter_mode'> => ({ charter: own, charter_mode: 'append' }),
} as const;

/**
 * What a role gives up on a remote harness (Hermes, Cursor Cloud, a custom harness), for the role editor
 * (Addendum A.4 of docs/plans/2026-11-18-user-defined-crew.md): it runs its own tools on its own server.
 */
export function remoteRoleNote(harness: string): string {
  const where = harness === 'cursor-cloud' ? 'Cursor Cloud' : 'a server outside Omni';
  return `This agent runs on ${where}, with its own tools and secrets. Omni cannot hold it to Only routes work, so that is refused; a review on it is only what its charter asks. It gets none of this machine's secrets, no browser, no worktree and no Omni tools, and its replies come back as data, not instructions.`;
}

/** The choices for a role's memory, as Settings > Crew offers them. */
export const ROLE_MEMORY_CHOICES: readonly { id: RoleMemoryMode; label: string; hint: string }[] = [
  { id: 'read-write', label: 'Reads and proposes', hint: 'Its threads get the lessons you approved, and propose new ones with remember.' },
  { id: 'read', label: 'Reads only', hint: 'Its threads get the lessons you approved. Only you add them.' },
  { id: 'off', label: 'Off', hint: 'Its threads get no lessons and propose none. What it has stays, unused.' },
];

/** Where a role's lesson applies, in a few words: every channel, or the channel it is tagged with. */
export const memoryScope = (m: Pick<Memory, 'channel_id'>): string => (m.channel_id ? `#${m.channel_id} only` : 'Every channel');
