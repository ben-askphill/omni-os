import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import { CREW_SHAPE_IDS, type CrewShapeId } from '@omni/shared/crew-shapes.ts';
import { parseAvatarImage } from './agent-avatar.ts';
import type { CrewLockedField, CrewLocks } from '@omni/shared/crew-settings.ts';
import { paths } from './config.ts';
import { fillPlaceholders, userConfig } from './user-config.ts';
import { parseConnectorList, parseTokenMap } from './connectors.ts';
import { isAccessLevel, type AccessLevel } from '@omni/shared/access.ts';
import { isRoleMemoryMode, type RoleMemoryMode, type RoleMemoryWrites } from '@omni/shared/memory.ts';
import { readsOnly } from '@omni/shared/quick-ask.ts';

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
/**
 * The tools a role's threads run with (`tools:`). `full`: everything. `no-edits`: no file-edit tools, with the shell
 * kept, so it is not read only (NO_EDITS_DENIED and the harness notes there). `delegate-only`: routes work and never
 * does it (DELEGATE_ONLY_DENIED). `delegate_only: true`, the older key, still reads as delegate-only.
 */
export type CrewTools = 'full' | 'no-edits' | 'delegate-only';
export const CREW_TOOLS: readonly CrewTools[] = ['full', 'no-edits', 'delegate-only'];
const isCrewTools = (v: unknown): v is CrewTools => CREW_TOOLS.includes(v as CrewTools);

/**
 * A role's own look: an image Ben uploaded (a data URL, agent-avatar.ts), else an icon (`icon:<name>` from the shared
 * set, one emoji, or an uploaded SVG as `svg:<markup>`) on a background, as a channel's, else its crew shape (ADR 0021).
 * The API sends the image as a URL (crew-api.ts), and the shape only when the file names one: clients pick the default.
 */
export interface CrewAvatar {
  /** A square PNG, JPEG or WebP, at most 256px a side, as a data URL. */
  image?: string;
  icon?: string;
  /** One of CREW_SHAPE_IDS. Unset: the shape the agent's id picks. */
  shape?: CrewShapeId;
  /** A six-digit hex color: the agent's one color, for the shape's body, an icon's disc and its mention pill. */
  bg?: string;
}

export interface CrewRole {
  id: string;
  name: string;
  description: string;
  /** Unset: a built-in keeps its mark, any other role its initials disc. */
  avatar?: CrewAvatar;
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  /** Extra MCP servers this role gets. "omni" = the conductor tools. */
  mcp: string[];
  /**
   * `access:`, the most this role may do in any channel (read, ask or full; packages/shared/access.ts). A channel set
   * stricter wins. Unset: the channel's level alone.
   */
  access?: AccessLevel;
  /**
   * `connectors:`, the accounts every thread of this role reads (connectors.ts ids such as slack or calendar). A new
   * thread of the role waits at its sign-in check while one is signed out. Unset when the role names none.
   */
  connectors?: string[];
  /**
   * `tokens:`, the accounts its threads reach through a token instead of their connector, by connector id, each with
   * the secret that holds the token (`notion: OMNI_NOTION_TOKEN`). While that secret reaches a thread that does its
   * own work (doesOwnWork), the sign-in check does not wait on the account's connector (runner/setup.ts connectorsFor).
   * Unset when the role names none.
   */
  tokens?: Record<string, string>;
  /** The tools its threads run with: everything, everything but the file-edit tools, or only what routes work. */
  tools: CrewTools;
  /** The role routes work and never does it: no shell, file edits, browser or subagents (DELEGATE_ONLY_DENIED). `tools` is delegate-only. */
  delegateOnly: boolean;
  /** The Conductor may hand work to it: list_crew offers it and `delegate` takes it. False for the Conductor and usage-scan. */
  delegatable: boolean;
  /**
   * A review role: a run on a GPT model is held at high effort (resolve.ts reviewerEffort), and a delegation with
   * `review_of` runs on the other model family from the thread it reviews (harness/review.ts). On for `reviewer`.
   */
  review: boolean;
  /**
   * `memory:`: whether its threads read its approved lessons (read), may also propose one with `remember`
   * (read-write, the default), or neither (off). Lessons live in the memories table (memory-api.ts).
   */
  memory: RoleMemoryMode;
  /** `memory_writes:`: a lesson its threads propose waits for the user (review, the default) or applies at once (auto). */
  memoryWrites: RoleMemoryWrites;
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
  /** What a save may not change on this role, and what may not be done to it, with why. Only the built-ins Omni relies on. */
  locks?: CrewLocks;
  error?: string;
}

/**
 * The built-ins Omni itself relies on, and what keeps them working (plan section 5). Keyed on the id, since what the
 * Conductor and a usage scan do is about Omni itself; the reviewer's lock only keeps its capability on. crew-store.ts
 * refuses a write that breaks one, and Settings shows each reason beside the field or action.
 */
export const CREW_LOCKS: Record<string, CrewLocks> = {
  conductor: {
    fields: {
      delegate_only: 'The Conductor only routes work, so it never gets working tools.',
      mcp: 'The Conductor delegates with the conductor tools, so it keeps them.',
      delegatable: 'Nothing delegates to the Conductor: it is the one that delegates.',
    },
    actions: {
      duplicate: 'The Conductor is not duplicated: there is one. Make another agent with New agent.',
      hide: 'The Conductor is never hidden: it is the front agent in #conductor.',
    },
  },
  'usage-scan': {
    fields: {
      delegate_only: 'A usage scan reads and suggests. It never does the work itself.',
      mcp: 'A usage scan suggests automations with the conductor tools, so it keeps them.',
      delegatable: 'Only Omni starts a usage scan, from the Automations page.',
      charter_mode: "Add to the built-in only: the scan's steps come with each release.",
    },
    actions: {
      duplicate: 'Usage scan is not duplicated: a copy would not be a usage scan, since only Omni starts one, with its report.',
      hide: 'Usage scan is never hidden: Omni starts it from the Automations page.',
    },
  },
  reviewer: {
    fields: {
      review: "Omni's review rules come with this agent. Duplicate it for a reviewer without them.",
    },
  },
};

/**
 * Built-ins that are never hidden, whatever the user config says. crew-store.ts refuses to hide them; this covers a
 * config written by hand.
 */
export const UNHIDEABLE = new Set(Object.keys(CREW_LOCKS).filter((id) => CREW_LOCKS[id].actions?.hide));

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

/** One of the 16 crew shapes this build draws (packages/shared/crew-shapes.ts). */
export const isCrewShape = (v: unknown): v is CrewShapeId => typeof v === 'string' && (CREW_SHAPE_IDS as readonly string[]).includes(v);

/**
 * The avatar a file names: an uploaded image (agent-avatar.ts, never an SVG), a shared icon, an emoji or an SVG icon
 * (channel-icon.ts checks it as it does a channel's), a crew shape and a hex color. A key that does not check out is
 * left out, so a hand edit gone wrong falls back to the next look, and a shape from a later build to the default one.
 */
export function avatarOf(v: unknown): CrewAvatar | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const { image, icon, shape, bg } = v as Record<string, unknown>;
  const kind = typeof icon === 'string' ? parseChannelIcon(icon)?.kind : undefined;
  const out: CrewAvatar = {
    ...(typeof image === 'string' && !('problem' in parseAvatarImage(image)) ? { image } : {}),
    ...(kind ? { icon: (icon as string).trim() } : {}),
    ...(isCrewShape(shape) ? { shape } : {}),
    ...(typeof bg === 'string' && AVATAR_BG.test(bg) ? { bg: bg.toLowerCase() } : {}),
  };
  return out.image || out.icon || out.shape || out.bg ? out : undefined;
}
/** A field the overlay sets wins; one it leaves out (or empties) falls back to the shipped file's. */
const pick = (key: string, over: Record<string, unknown>, base: Record<string, unknown>) =>
  over[key] !== undefined && over[key] !== null && over[key] !== '' ? over[key] : base[key];

/** A role's `connectors:`, when it names valid ones. A bad list is left out rather than holding every thread. */
function connectorsOf(raw: unknown): { connectors?: string[] } {
  if (raw === undefined || raw === null) return {};
  const ids = parseConnectorList(raw);
  return Array.isArray(ids) && ids.length ? { connectors: ids } : {};
}

/** A role's `tokens:`, when it is a valid map. A bad one is left out, so the role waits for its connectors as before. */
function tokensOf(raw: unknown): { tokens?: Record<string, string> } {
  if (raw === undefined || raw === null) return {};
  const map = parseTokenMap(raw);
  return typeof map === 'object' && Object.keys(map).length ? { tokens: map } : {};
}

/**
 * A role's tools: delegate-only when either key says so (an overlay's `tools: full` never undoes a built-in's
 * `delegate_only: true`), else what `tools:` names, else full.
 */
export function toolsOf(meta: Record<string, unknown>): CrewTools {
  if (meta.delegate_only === true || meta.tools === 'delegate-only') return 'delegate-only';
  return isCrewTools(meta.tools) ? meta.tools : 'full';
}

function roleOf(id: string, meta: Record<string, unknown>, body: string, kind: CrewKind, error?: string): CrewRole {
  const tools = toolsOf(meta);
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
    ...connectorsOf(meta.connectors),
    ...tokensOf(meta.tokens),
    ...(isAccessLevel(meta.access) && { access: meta.access }),
    tools,
    delegateOnly: tools === 'delegate-only',
    delegatable: meta.delegatable !== false,
    review: meta.review === true,
    memory: isRoleMemoryMode(meta.memory) ? meta.memory : 'read-write',
    memoryWrites: meta.memory_writes === 'auto' ? 'auto' : 'review',
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

/** A locked field as the role reads it, so a role is compared with its built-in. The conductor tools count, not the whole list. */
export const LOCKED_VALUE: Record<CrewLockedField, (r: CrewRole) => unknown> = {
  delegate_only: (r) => r.delegateOnly,
  mcp: (r) => r.mcp.includes('omni'),
  delegatable: (r) => r.delegatable,
  review: (r) => r.review,
  charter_mode: (r) => r.charterMode ?? 'append',
};

/** The locks (CREW_LOCKS) an overlay on built-in `id` breaks, each with why it holds. */
export function lockBreaks(id: string, shipped: CrewSource, overlay: CrewSource): [CrewLockedField, string][] {
  const locks = Object.entries(CREW_LOCKS[id]?.fields ?? {}) as [CrewLockedField, string][];
  if (!locks.length) return [];
  const role = mergeCrew(id, shipped, overlay);
  const builtIn = roleOf(id, shipped.meta, shipped.body, 'shipped');
  return locks.filter(([key]) => LOCKED_VALUE[key](role) !== LOCKED_VALUE[key](builtIn));
}

/**
 * The overlay as Omni runs it: a key that breaks a lock is left out, so the built-in's value holds (a charter that
 * must be added to is added). crew-store.ts refuses such a save and the sync handler such a file, so only a file
 * written by hand gets here.
 */
export function lockedOverlay(id: string, shipped: CrewSource, overlay: CrewSource): CrewSource {
  const breaks = lockBreaks(id, shipped, overlay);
  if (!breaks.length) return overlay;
  const meta = { ...overlay.meta };
  for (const [key] of breaks) {
    if (key === 'charter_mode') meta.charter_mode = 'append';
    else {
      delete meta[key];
      // `tools:` can make a role delegate-only too, so the built-in's value holds only with both keys gone.
      if (key === 'delegate_only') delete meta.tools;
    }
  }
  return { ...overlay, meta };
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
  if (shipped !== null && own !== null) {
    const base = splitCrewFile(shipped);
    role = mergeCrew(id, base, lockedOverlay(id, base, splitCrewFile(own)));
  }
  else if (shipped !== null) role = { ...parseCrewFile(id, shipped), kind: 'shipped' };
  else if (own !== null) role = parseCrewFile(id, own);
  else return null;
  role.hidden = role.kind !== 'own' && !UNHIDEABLE.has(id) && userConfig().crew?.[id]?.hidden === true;
  if (role.kind !== 'own' && CREW_LOCKS[id]) role.locks = CREW_LOCKS[id];
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
  if (!role) return { refused: `No agent "${id}". Agents: ${valid()}.`, status: 400 };
  if (role.hidden) return { refused: `The agent "${id}" is hidden on this machine. Show it in Settings > Agents, or pick one of: ${valid()}.`, status: 409 };
  if (delegated && !role.delegatable) return { refused: `The agent "${id}" cannot be delegated to. Agents: ${valid()}.`, status: 409 };
  return { role };
}

/**
 * A thread that does its own work: not a routing role's, not a quick ask and not in a read-only workspace. Only these
 * get the workspace and Notion sections of the prompt (runner/prompts.ts), so only these reach an account through a
 * role's `tokens:`.
 */
export const doesOwnWork = (t: { quick?: number | null; workspace?: string | null }, role?: CrewRole) => !role?.delegateOnly && !readsOnly(t);

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
 * The Claude Code tools a no-edits role runs without: the ones that write files. Bash stays, for `gh`, git and running
 * checks, so a command can still change a file: no-edits is not read only. Codex declines its file patches instead
 * (harness/codex/session-start.ts), Cursor denies `Write(**)` (CURSOR_NO_EDITS_DENY in sandbox.ts), and Hermes and
 * Cursor Cloud, where Omni cannot take a tool away, get it as an instruction in the prompt (runner/prompts.ts).
 */
export const NO_EDITS_DENIED = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/**
 * What a seated member of a group thread loses on Claude Code (ADR 0019, Q24): the git commands that commit, move or
 * rewrite the branch, and opening a pull request. Its lead commits. Other harnesses take the rule from the prompt.
 * A guard against two agents racing on git in one worktree, not a security boundary: a member keeps Bash, as its lead
 * does, so it could still reach git another way.
 */
export const MEMBER_DENIED = [
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git rebase:*)', 'Bash(git reset:*)', 'Bash(git stash:*)', 'Bash(git checkout:*)',
  'Bash(git switch:*)', 'Bash(git merge:*)', 'Bash(git pull:*)', 'Bash(gh pr create:*)', 'Bash(gh pr merge:*)',
];

/**
 * Why a delegate-only role cannot run on a remote harness (Hermes, Cursor Cloud): it would have no omni tools to
 * delegate with, and Omni cannot take its work tools away there, so it could only do the work itself.
 */
export const remoteDelegateOnlyRefusal = (role: string, where: string) =>
  `${role} only routes work, with Omni's delegate tools, and a thread that runs ${where} does not get them. Omni cannot take that agent's own tools away either, so it would do the work itself. Run ${role} on Claude Code, Codex or Cursor instead.`;
