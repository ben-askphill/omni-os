import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import { paths } from './config.ts';
import { fillPlaceholders, userConfig } from './user-config.ts';

// Crew roles: one markdown file each, frontmatter and a charter. The shipped ones live in crew/ and each release
// replaces them. The user's own live in data/crew/: a file there with a new id is a whole role of theirs, and one with
// a shipped id is an overlay on that built-in. An overlay sets only the fields it names, and its body is added after
// the shipped charter (`charter_mode: append`) or replaces it (`replace`, and any overlay that names no mode, which is
// how a copy behaved before overlays). crew-store.ts decides what a write may change; this module reads the files and
// writes the user's whole, with nothing but fs and the user config, so the sync handler (sync/handlers/crew-file.ts)
// can write one without loading the harness catalog.
//
// `harness` is the role's runtime binding and stays an open string: whatever harness catalog this machine has decides
// what it can run, and an outside agent later joins that catalog by id (docs/plans/2026-11-18-user-defined-crew.md
// section 2.5). Keys this module does not know are left in the file for whoever does.

/** Where a role comes from: shipped in crew/, a built-in with the user's overlay, or the user's own. */
export type CrewKind = 'shipped' | 'edited' | 'own';
/** How an overlay's body joins the shipped charter. */
export type CharterMode = 'append' | 'replace';

/** A role's own look, as a channel's: an icon (`icon:<name>` from the shared set, or one emoji) and a background. */
export interface CrewAvatar {
  icon?: string;
  /** A six-digit hex color. */
  bg?: string;
}

export interface CrewRole {
  id: string;
  name: string;
  description: string;
  /** Unset: a built-in keeps its mark, any other role its monogram. */
  avatar?: CrewAvatar;
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  /** Extra MCP servers this role gets. "omni" = the conductor tools. */
  mcp: string[];
  /** The role routes work and never does it: no shell, file edits, browser or subagents (DELEGATE_ONLY_DENIED). */
  delegateOnly: boolean;
  /** The Conductor may hand work to it: list_crew offers it and `delegate` takes it. False for the Conductor and usage-scan. */
  delegatable: boolean;
  charter: string;
  kind: CrewKind;
  /** Hidden on this machine. Built-ins only: no new thread starts as it, and lists leave it out unless asked. */
  hidden: boolean;
  /** An edited built-in's: how its body joins the shipped charter. */
  charterMode?: CharterMode;
  /**
   * An edited built-in that replaces the shipped charter, and the shipped charter is no longer the one it was written
   * against (or the overlay never recorded which, as a hand copy does). The user may be missing a release's fixes.
   */
  builtInChanged?: boolean;
  error?: string;
}

/**
 * Built-ins that are never hidden, whatever the user config says: the Conductor is the front agent, and Omni starts a
 * usage scan as usage-scan. crew-store.ts refuses to hide them; this covers a config written by hand.
 */
export const UNHIDEABLE = new Set(['conductor', 'usage-scan']);

/** A crew file split into its frontmatter and body. `meta` is {} when the frontmatter does not parse. */
export interface CrewSource {
  meta: Record<string, unknown>;
  body: string;
  error?: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function splitCrewFile(src: string): CrewSource {
  const m = src.match(FRONTMATTER);
  if (!m) return { meta: {}, body: src.trim() };
  try {
    const meta = YAML.parse(m[1]) ?? {};
    return { meta: typeof meta === 'object' && !Array.isArray(meta) ? meta : {}, body: m[2].trim() };
  } catch (err) {
    // A typo in one charter must not break every thread that uses a role.
    return { meta: {}, body: m[2].trim(), error: `bad frontmatter: ${(err as Error).message}` };
  }
}

/** The hash an overlay records as `based_on`: the shipped charter's body it was written against, before placeholders. */
export const charterHash = (body: string) => createHash('sha256').update(body.trim()).digest('hex').slice(0, 12);

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const AVATAR_BG = /^#[0-9a-f]{6}$/i;

/** The avatar a file names: a shared icon or an emoji (never an uploaded SVG, which would not read in a file), and a hex color. */
export function avatarOf(v: unknown): CrewAvatar | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const { icon, bg } = v as Record<string, unknown>;
  const kind = typeof icon === 'string' ? parseChannelIcon(icon)?.kind : undefined;
  const out: CrewAvatar = {
    ...(kind === 'glyph' || kind === 'emoji' ? { icon: icon as string } : {}),
    ...(typeof bg === 'string' && AVATAR_BG.test(bg) ? { bg: bg.toLowerCase() } : {}),
  };
  return out.icon || out.bg ? out : undefined;
}
/** A field the overlay sets wins; one it leaves out (or empties) falls back to the shipped file's. */
const pick = (key: string, over: Record<string, unknown>, base: Record<string, unknown>) =>
  over[key] !== undefined && over[key] !== null && over[key] !== '' ? over[key] : base[key];

function roleOf(id: string, meta: Record<string, unknown>, body: string, kind: CrewKind, error?: string): CrewRole {
  return {
    id,
    name: text(meta.name) ?? id,
    description: typeof meta.description === 'string' ? meta.description : '',
    avatar: avatarOf(meta.avatar),
    harness: text(meta.harness),
    model: text(meta.model),
    effort: text(meta.effort),
    channel: text(meta.channel),
    mcp: Array.isArray(meta.mcp) ? meta.mcp.filter((x): x is string => typeof x === 'string') : [],
    delegateOnly: meta.delegate_only === true,
    delegatable: meta.delegatable !== false,
    charter: fillPlaceholders(body),
    kind,
    hidden: false,
    ...(error && { error }),
  };
}

/** One file read as a whole role, as a role of the user's own is. */
export function parseCrewFile(id: string, src: string): CrewRole {
  const { meta, body, error } = splitCrewFile(src);
  return roleOf(id, meta, body, 'own', error);
}

/** A built-in's frontmatter and charter with the overlay laid over them, placeholders not yet filled. */
export function mergeSources(shipped: CrewSource, overlay: CrewSource): { meta: Record<string, unknown>; body: string; mode: CharterMode } {
  const keys = new Set([...Object.keys(shipped.meta), ...Object.keys(overlay.meta)]);
  const meta = Object.fromEntries([...keys].map((k) => [k, pick(k, overlay.meta, shipped.meta)]));
  const mode: CharterMode = overlay.meta.charter_mode === 'append' ? 'append' : 'replace';
  const body = mode === 'append' ? [shipped.body, overlay.body].filter(Boolean).join('\n\n') : overlay.body;
  return { meta, body, mode };
}

/** A built-in with the user's overlay laid over it. */
export function mergeCrew(id: string, shipped: CrewSource, overlay: CrewSource): CrewRole {
  const { meta, body, mode } = mergeSources(shipped, overlay);
  const role = roleOf(id, meta, body, 'edited', overlay.error ?? shipped.error);
  role.charterMode = mode;
  if (mode === 'replace') role.builtInChanged = overlay.meta.based_on !== charterHash(shipped.body);
  return role;
}

/** The .md files in dir, by role id. */
export function crewFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const f of readdirSync(dir)) if (f.endsWith('.md')) files.set(f.slice(0, -3), join(dir, f));
  return files;
}

/** The raw text of a role's shipped file and the user's file, either null when there is none. */
export function crewTexts(id: string): { shipped: string | null; own: string | null } {
  const read = (dir: string) => {
    const file = crewFiles(dir).get(id);
    return file ? readFileSync(file, 'utf8') : null;
  };
  return { shipped: read(paths.crew), own: read(paths.personalCrew) };
}

/** A role id as a file name: lowercase words and dashes, like an automation's. Never changes once a role has it. */
export const CREW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const ownCrewFile = (id: string) => join(paths.personalCrew, `${id}.md`);

/** Write the user's file for a role whole: a tmp file, then a rename, so a reader never sees half of it. */
export function writeOwnCrew(id: string, text: string) {
  mkdirSync(paths.personalCrew, { recursive: true });
  const tmp = join(paths.personalCrew, `.${id}.md.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, ownCrewFile(id));
}

/** Remove the user's file for a role. False when there was none. */
export function removeOwnCrew(id: string): boolean {
  const file = crewFiles(paths.personalCrew).get(id);
  if (!file) return false;
  rmSync(file);
  return true;
}

function readRole(id: string, shipped: string | null, own: string | null): CrewRole | null {
  let role: CrewRole;
  if (shipped !== null && own !== null) role = mergeCrew(id, splitCrewFile(shipped), splitCrewFile(own));
  else if (shipped !== null) role = { ...parseCrewFile(id, shipped), kind: 'shipped' };
  else if (own !== null) role = parseCrewFile(id, own);
  else return null;
  role.hidden = role.kind !== 'own' && !UNHIDEABLE.has(id) && userConfig().crew?.[id]?.hidden === true;
  return role;
}

// Read from disk each time: charters are meant to be edited while the server runs.
/** Every role, hidden ones included, the Conductor first. */
export function listCrew(): CrewRole[] {
  const shipped = crewFiles(paths.crew);
  const own = crewFiles(paths.personalCrew);
  const ids = new Set([...shipped.keys(), ...own.keys()]);
  return [...ids]
    .map((id) => readRole(id, read(shipped.get(id)), read(own.get(id)))!)
    .sort((a, b) => (a.id === 'conductor' ? -1 : b.id === 'conductor' ? 1 : a.id.localeCompare(b.id)));
}

const read = (file: string | undefined) => (file ? readFileSync(file, 'utf8') : null);

/** A role by id, hidden or not: a thread that already runs as a role keeps its charter when the role is hidden. */
export function getCrew(id?: string | null): CrewRole | undefined {
  if (!id) return undefined;
  const { shipped, own } = crewTexts(id);
  return readRole(id, shipped, own) ?? undefined;
}

/**
 * The role a new thread may start as, or why not: an id no role has, a role hidden on this machine, or, for a thread
 * the Conductor or a team delegates, one that is not delegatable. Null when no role was asked for.
 */
export function crewForNewThread(id: string | null | undefined, delegated: boolean): { role: CrewRole | null } | { refused: string; status: 400 | 409 } {
  if (!id) return { role: null };
  const role = getCrew(id);
  const valid = () =>
    listCrew()
      .filter((r) => !r.hidden && (!delegated || r.delegatable))
      .map((r) => r.id)
      .join(', ');
  if (!role) return { refused: `No crew role "${id}". Roles: ${valid()}.`, status: 400 };
  if (role.hidden) return { refused: `The crew role "${id}" is hidden on this machine. Show it in Settings, or pick one of: ${valid()}.`, status: 409 };
  if (delegated && !role.delegatable) return { refused: `The crew role "${id}" cannot be delegated to. Roles: ${valid()}.`, status: 409 };
  return { role };
}

/**
 * The Claude Code tools a delegate-only role runs without: everything that changes files, runs commands, drives a
 * browser or starts work in-thread. Reading, searching, the omni tools and ask_user_question stay, so it can still
 * look up enough to write a brief. Codex gets a read-only sandbox instead (harness/codex/adapter.ts).
 */
export const DELEGATE_ONLY_DENIED = [
  'Bash', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'Task', 'Workflow', 'Artifact', 'ArtifactData',
  'mcp__omni-browser', 'mcp__plugin_playwright_playwright', 'mcp__plugin_chrome-devtools-mcp_chrome-devtools',
];

/**
 * Why a delegate-only role cannot run on a remote harness (Hermes, Cursor Cloud): it would have no omni tools to
 * delegate with, and Omni cannot take its work tools away there, so it could only do the work itself.
 */
export const remoteDelegateOnlyRefusal = (role: string, where: string) =>
  `${role} only routes work, with Omni's delegate tools, and a thread that runs ${where} does not get them. Omni cannot take that agent's own tools away either, so it would do the work itself. Run ${role} on Claude Code, Codex or Cursor instead.`;
