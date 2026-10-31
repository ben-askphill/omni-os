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
import {
  isTimezone,
  NAME_MAX,
  SETTING_SECTIONS,
  sectionFields,
  settingProblem,
  type SettingField,
  type SettingSection,
  type UserConfig,
  type UserConfigPatch,
} from '@omni/shared/settings.ts';
import { DEFAULT_RETENTION, RETENTION_DAYS } from '@omni/shared/worktree-cleanup.ts';

export { isTimezone, NAME_MAX };
export type { AutomationOverride, UserConfig, UserConfigPatch } from '@omni/shared/settings.ts';

/** The repo root, the same as config.ts's ROOT (kept here so this module does not import config.ts). */
const ROOT = resolve(import.meta.dirname, '../..');
const dataDir = () => (process.env.OMNI_DATA_DIR ? resolve(ROOT, process.env.OMNI_DATA_DIR) : join(ROOT, 'data'));

/** Where the file lives. OMNI_CONFIG moves it, like OMNI_DATA_DIR moves the rest. */
export const configPath = () => (process.env.OMNI_CONFIG ? resolve(ROOT, process.env.OMNI_CONFIG) : join(dataDir(), 'omni.config.json'));

/** The fields, their defaults and checks are @omni/shared/settings.ts; this builds the schema the file is read with. */
const fieldSchema = (f: SettingField) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const problem = settingProblem(f, v, 'file');
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    })
    .default(f.default);

const sectionSchema = (section: SettingSection) =>
  z.object(Object.fromEntries(sectionFields(section).map((f) => [f.key, fieldSchema(f)])) as Record<string, ReturnType<typeof fieldSchema>>);

const automationOverride = z.object({ enabled: z.boolean().optional(), channel: z.string().optional() });

const schema = z.object({
  version: z.literal(1).default(1),
  onboardedAt: z.string().optional(),
  user: sectionSchema('user').prefault({}),
  workspace: sectionSchema('workspace').prefault({}),
  integrations: sectionSchema('integrations').prefault({}),
  /** Per machine, like the rest of this file (apps/server/run-on.ts). */
  runOn: z.object({ device: z.string().trim().max(100).default('') }).prefault({}),
  automations: z.record(z.string(), automationOverride).default({}),
  /** Off until turned on in Settings > Machines. */
  worktrees: z
    .object({
      retention: z
        .object({
          enabled: z.boolean().default(DEFAULT_RETENTION.enabled),
          idleDays: z.number().int().min(RETENTION_DAYS.min).max(RETENTION_DAYS.max).default(DEFAULT_RETENTION.idleDays),
        })
        .prefault({}),
    })
    .prefault({}),
});

/** Reads a saved file (or a part of one) into a full UserConfig, defaults filled in. */
export const userConfigSchema = { parse: (v: unknown): UserConfig => schema.parse(v) as UserConfig };

/** A partial update: any section, any subset of its fields. A client's save also goes through `checkSettingFields`. */
export const userConfigPatch = z.object({
  onboardedAt: z.string().nullish(),
  user: sectionSchema('user').partial().optional(),
  workspace: sectionSchema('workspace').partial().optional(),
  integrations: sectionSchema('integrations').partial().optional(),
  runOn: schema.shape.runOn.unwrap().partial().optional(),
  automations: z.record(z.string(), automationOverride.nullable()).optional(),
});

/** A client's save, each text field checked as `settingProblem(.., 'save')` says. For a zod superRefine. */
export function checkSettingFields(p: Partial<Record<SettingSection, Record<string, string | undefined>>>, ctx: z.RefinementCtx) {
  for (const section of SETTING_SECTIONS) {
    for (const f of sectionFields(section)) {
      const v = p[section]?.[f.key];
      const problem = v === undefined ? null : settingProblem(f, v, 'save');
      if (problem) ctx.addIssue({ code: 'custom', path: [section, f.key], message: problem });
    }
  }
}

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
    runOn: { ...cur.runOn, ...patch.runOn },
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
  tailscaleLogins: () =>
    (process.env.OMNI_TAILSCALE_LOGIN ?? userConfig().integrations.tailscaleLogin)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
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
