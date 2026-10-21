// The person's own settings: who they are, where their work lives and which integrations they use. One JSON
// file in the data dir (data/omni.config.json, gitignored with the rest of data/), so a fork of the repo carries
// none of it and pulling upstream never touches it. `omni.config.example.json` at the repo root shows every field.
//
// Precedence for each value: env var (tests, one-off runs, the old .env) > this file > a default worked out from
// the machine (os.homedir(), the system timezone). No module here imports db.ts, so `npm run setup` and config.ts
// can use it before the database is open.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/** The repo root, the same as config.ts's ROOT (kept here so this module does not import config.ts). */
const ROOT = resolve(import.meta.dirname, '../..');
const dataDir = () => (process.env.OMNI_DATA_DIR ? resolve(ROOT, process.env.OMNI_DATA_DIR) : join(ROOT, 'data'));

/** Where the file lives. OMNI_CONFIG moves it, like OMNI_DATA_DIR moves the rest. */
export const configPath = () => (process.env.OMNI_CONFIG ? resolve(ROOT, process.env.OMNI_CONFIG) : join(dataDir(), 'omni.config.json'));

export const NAME_MAX = 60;

const automationOverride = z.object({ enabled: z.boolean().optional(), channel: z.string().optional() });

export const userConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Set when onboarding (web, Mac or `npm run setup`) finished. Missing means both clients show the wizard. */
  onboardedAt: z.string().optional(),
  user: z
    .object({
      name: z.string().trim().max(NAME_MAX, `Keep the name under ${NAME_MAX} characters.`).default(''),
      pronouns: z.string().trim().max(40).default('they/them'),
      email: z.string().trim().max(200).default(''),
      /** IANA zone. Empty means the system's. */
      timezone: z.string().trim().default(''),
    })
    .prefault({}),
  workspace: z
    .object({
      /** The folder non-repo threads run in, added to every Claude thread with its CLAUDE.md. Empty means ~/Omni. */
      root: z.string().trim().default(''),
      /** Where the person keeps their git checkouts. Empty means ~/code. */
      reposDir: z.string().trim().default(''),
      /** GitHub user or org that owns their repos and their fork of Omni. */
      githubOwner: z.string().trim().default(''),
    })
    .prefault({}),
  integrations: z
    .object({
      /** Hermes API server, like http://100.x.y.z:8642. Empty means Hermes is off. */
      hermesUrl: z.string().trim().default(''),
      /** A second-brain git repo the brain-export automation writes digests into. Empty means off. */
      centralBrainDir: z.string().trim().default(''),
    })
    .prefault({}),
  /** Per-machine overrides of the shared automation YAML (`enabled`, `channel`), so toggling one never edits the repo. */
  automations: z.record(z.string(), automationOverride).default({}),
});

export type UserConfig = z.infer<typeof userConfigSchema>;
export type AutomationOverride = z.infer<typeof automationOverride>;

/** A partial update: any section, any subset of its fields. */
export type UserConfigPatch = {
  onboardedAt?: string | null;
  user?: Partial<UserConfig['user']>;
  workspace?: Partial<UserConfig['workspace']>;
  integrations?: Partial<UserConfig['integrations']>;
  automations?: Record<string, AutomationOverride | null>;
};

export const userConfigPatch = z.object({
  onboardedAt: z.string().nullish(),
  user: userConfigSchema.shape.user.unwrap().partial().optional(),
  workspace: userConfigSchema.shape.workspace.unwrap().partial().optional(),
  integrations: userConfigSchema.shape.integrations.unwrap().partial().optional(),
  automations: z.record(z.string(), automationOverride.nullable()).optional(),
});

const defaults = (): UserConfig => userConfigSchema.parse({});

let cache: { mtimeMs: number; path: string; value: UserConfig | null } | null = null;

/** The file as saved, or null when there is none. Read again whenever it changes on disk (`npm run setup` while the server runs). */
export function readUserConfig(): UserConfig | null {
  const path = configPath();
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    /* no file */
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.value;
  let value: UserConfig | null = null;
  if (mtimeMs >= 0) {
    try {
      value = userConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch (err) {
      // A typo must not take the server down: run on defaults and say why.
      console.error(`[omni] ignoring ${path}: ${(err as Error).message}`);
      value = defaults();
      value.onboardedAt = new Date(0).toISOString();
    }
  }
  cache = { mtimeMs, path, value };
  return value;
}

/** The saved file, or the defaults when there is none yet. */
export const userConfig = (): UserConfig => readUserConfig() ?? defaults();

export const configExists = () => readUserConfig() !== null;
export const isOnboarded = () => !!readUserConfig()?.onboardedAt;

export function writeUserConfig(next: UserConfig) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const valid = userConfigSchema.parse(next);
  // Write then rename, so a reader never sees half a file.
  writeFileSync(`${path}.tmp`, JSON.stringify(valid, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
  cache = null;
  return valid;
}

/** Merge a patch into the saved file (or the defaults) and write it. Null removes an automation override or onboardedAt. */
export function updateUserConfig(patch: UserConfigPatch): UserConfig {
  const cur = userConfig();
  const automations = { ...cur.automations };
  for (const [id, o] of Object.entries(patch.automations ?? {})) {
    if (o === null) delete automations[id];
    else automations[id] = { ...automations[id], ...o };
  }
  const next: UserConfig = {
    ...cur,
    user: { ...cur.user, ...patch.user },
    workspace: { ...cur.workspace, ...patch.workspace },
    integrations: { ...cur.integrations, ...patch.integrations },
    automations,
  };
  if (patch.onboardedAt === null) delete next.onboardedAt;
  else if (patch.onboardedAt) next.onboardedAt = patch.onboardedAt;
  return writeUserConfig(next);
}

// ---------- resolved values ----------

const home = () => homedir();

/** `~` and `~/x` become absolute under the home folder; a relative path resolves against it too. */
export function expandHome(p: string) {
  if (!p) return p;
  if (p === '~') return home();
  if (p.startsWith('~/')) return join(home(), p.slice(2));
  return isAbsolute(p) ? p : join(home(), p);
}

/** The reverse, for showing a path: /Users/x/code becomes ~/code. */
export function tildify(p: string) {
  const h = home();
  return p === h ? '~' : p.startsWith(h + '/') ? `~${p.slice(h.length)}` : p;
}

export function systemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** What a fresh install falls back to, shown as placeholders in onboarding. */
export const fallbacks = () => ({
  timezone: systemTimezone(),
  workspaceRoot: join(home(), 'Omni'),
  reposDir: join(home(), 'code'),
  home: home(),
});

export const resolved = {
  name: () => userConfig().user.name,
  pronouns: () => userConfig().user.pronouns || 'they/them',
  email: () => userConfig().user.email,
  timezone: () => process.env.OMNI_TZ || userConfig().user.timezone || systemTimezone(),
  workspaceRoot: () => process.env.OMNI_BRAIN_DIR || expandHome(userConfig().workspace.root) || fallbacks().workspaceRoot,
  reposDir: () => expandHome(userConfig().workspace.reposDir) || fallbacks().reposDir,
  githubOwner: () => userConfig().workspace.githubOwner,
  hermesUrl: () => (process.env.OMNI_HERMES_URL ?? userConfig().integrations.hermesUrl ?? '').replace(/\/$/, ''),
  centralBrainDir: () => expandHome(process.env.OMNI_CENTRAL_BRAIN_DIR || userConfig().integrations.centralBrainDir),
};

/** How prompts refer to the person: their name, or "the user" until one is set. */
export const userName = () => resolved.name() || 'the user';
/** "Tijs's" or "the user's". */
export const userPossessive = () => `${userName()}'s`;

/** The object pronoun for "ask them to take over": him, her, them, or the first word after the slash of a custom set. */
export function objectPronoun(pronouns = resolved.pronouns()) {
  const p = pronouns.toLowerCase().trim();
  if (p.startsWith('he')) return 'him';
  if (p.startsWith('she')) return 'her';
  if (p.startsWith('they') || !p) return 'them';
  const parts = p.split('/').map((s) => s.trim()).filter(Boolean);
  return parts[1] ?? parts[0] ?? 'them';
}

// ---------- the Omni checkout itself ----------

let originCache: string | null | undefined;
/** owner/repo of this checkout's `origin`, for the forker's own PRs. Null when there is no GitHub remote. */
export function omniRepo(): string | null {
  if (originCache !== undefined) return originCache;
  try {
    const url = execFileSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    originCache = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;
  } catch {
    originCache = null;
  }
  return originCache;
}

/**
 * Fill `{{placeholders}}` in a crew charter or an automation prompt, so the shared files in the repo name nobody:
 * {{user}}, {{workspace}}, {{reposDir}}, {{githubOwner}}, {{omniRoot}}, {{omniRepo}}, {{centralBrain}}, {{timezone}}.
 * An unknown placeholder stays as written.
 */
export function fillPlaceholders(text: string) {
  const values: Record<string, () => string> = {
    user: userName,
    workspace: () => tildify(resolved.workspaceRoot()),
    reposDir: () => tildify(resolved.reposDir()),
    githubOwner: () => resolved.githubOwner() || '<your GitHub owner>',
    omniRoot: () => tildify(ROOT),
    omniRepo: () => omniRepo() ?? '<your Omni repo>',
    centralBrain: () => tildify(resolved.centralBrainDir()) || '<your central brain folder>',
    timezone: resolved.timezone,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => (values[key] ? values[key]() : all));
}

/** Make the workspace folder when onboarding picked one that does not exist yet. */
export function ensureWorkspace() {
  const root = resolved.workspaceRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}
