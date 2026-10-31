// The user config's one contract (data/omni.config.json, GET and PUT /api/setup): every field the person sets, with
// its label, hint, default and checks, and the types the server and the web import. The server builds its schema from
// SETTING_FIELDS (apps/server/user-config.ts) and checks a save with `settingProblem`; the web's Settings page draws its
// General and Workspace forms from them (apps/web/src/pages/Settings.tsx). The Mac app's Setup.swift and
// ProfileSettingsView.swift mirror them; apps/server/tests/mac-fixtures.test.ts holds both to this file.
//
// A new text setting is one entry here, its property in Setup.swift, its row in ProfileSettingsView.swift and its
// line in omni.config.example.json.

export const NAME_MAX = 60;

/** The config's sections that hold text settings. */
export type SettingSection = 'user' | 'workspace' | 'integrations';

/**
 * How a field is typed and checked. `folder`: one line without control characters, backticks or $, since prompts
 * quote it. `owner`: a GitHub user or org. `url`: http or https. `pronouns` and `timezone` get their own pickers.
 */
export type SettingInput = 'text' | 'email' | 'folder' | 'owner' | 'url' | 'pronouns' | 'timezone';

/** What a field's placeholder shows when it has none of its own: this machine's default (SetupState.fallbacks). */
export type SettingFallback = 'timezone' | 'workspaceRoot' | 'reposDir';

export interface SettingField {
  section: SettingSection;
  key: string;
  label: string;
  input: SettingInput;
  /** The Settings section that shows it, or none for a field only the file sets. */
  page: SettingPage | null;
  /** Folded under Advanced. */
  advanced?: boolean;
  /** Shares its row with the next field that has it too. */
  half?: boolean;
  /** Under the label. `{fallback}` is this machine's default. */
  hint?: string;
  placeholder?: string;
  fallback?: SettingFallback;
  default: string;
  max?: number;
  /** Refused when empty on save, with this message. */
  required?: string;
  /** The browser's autofill hint. */
  autoComplete?: string;
}

export type SettingPage = 'general' | 'workspace';

/** How each Settings section frames its fields: the card's title, and the Advanced fold's summary and note. */
export const SETTING_PAGES: Record<SettingPage, { title: string; advanced?: { summary: string; note: string } }> = {
  general: { title: 'You' },
  workspace: {
    title: 'Workspace',
    advanced: { summary: 'Hermes URL and central brain folder', note: 'Optional integrations. Leave a field empty to turn it off.' },
  },
};

/** In the order each Settings section shows them. */
export const SETTING_FIELDS = [
  {
    section: 'user',
    key: 'name',
    label: 'Name',
    input: 'text',
    page: 'general',
    hint: 'Used in the greeting on Home and told to every agent, so a thread knows who it works for.',
    placeholder: 'Your name',
    autoComplete: 'name',
    default: '',
    max: NAME_MAX,
    required: 'Enter a name.',
  },
  { section: 'user', key: 'pronouns', label: 'Pronouns', input: 'pronouns', page: 'general', half: true, default: 'they/them', max: 40 },
  {
    section: 'user',
    key: 'timezone',
    label: 'Timezone',
    input: 'timezone',
    page: 'general',
    half: true,
    hint: "Empty uses the server's: {fallback}.",
    fallback: 'timezone',
    default: '',
  },
  { section: 'user', key: 'email', label: 'Email', input: 'email', page: 'general', placeholder: 'you@example.com', autoComplete: 'email', default: '', max: 200 },
  {
    section: 'workspace',
    key: 'root',
    label: 'Workspace folder',
    input: 'folder',
    page: 'workspace',
    hint: 'Threads without a repo run here; its CLAUDE.md and skills load in every Claude thread.',
    fallback: 'workspaceRoot',
    default: '',
    max: 1024,
  },
  { section: 'workspace', key: 'reposDir', label: 'Repos folder', input: 'folder', page: 'workspace', fallback: 'reposDir', default: '', max: 1024 },
  { section: 'workspace', key: 'githubOwner', label: 'GitHub owner', input: 'owner', page: 'workspace', hint: 'Your GitHub user or org.', placeholder: 'octocat', default: '' },
  {
    section: 'integrations',
    key: 'hermesUrl',
    label: 'Hermes URL',
    input: 'url',
    page: 'workspace',
    advanced: true,
    hint: 'A Hermes API server on your tailnet. Its token is the global secret HERMES_API_KEY.',
    placeholder: 'http://100.64.0.1:8642',
    default: '',
  },
  {
    section: 'integrations',
    key: 'centralBrainDir',
    label: 'Central brain folder',
    input: 'folder',
    page: 'workspace',
    advanced: true,
    hint: 'A git repo of notes that the brain-nightly automation exports thread digests into.',
    placeholder: '~/central-brain',
    default: '',
    max: 1024,
  },
  {
    // Tailscale logins allowed in through `tailscale serve`, comma separated, like ada@example.com. Set, a request on
    // a *.ts.net or 100.64.0.0/10 Host needs a matching Tailscale-User-Login header as well as the token.
    section: 'integrations',
    key: 'tailscaleLogin',
    label: 'Tailscale logins',
    input: 'text',
    page: null,
    default: '',
    max: 500,
  },
] as const satisfies readonly SettingField[];

type Field = (typeof SETTING_FIELDS)[number];
export type SectionValues<S extends SettingSection> = { [F in Extract<Field, { section: S }> as F['key']]: string };

export const SETTING_SECTIONS: readonly SettingSection[] = ['user', 'workspace', 'integrations'];

export const sectionFields = (section: SettingSection): readonly SettingField[] => SETTING_FIELDS.filter((f) => f.section === section);

/** The fields one Settings section shows, in order. */
export const pageFields = (page: SettingPage): readonly SettingField[] => SETTING_FIELDS.filter((f) => f.page === page);

/** Per-machine overrides of the shared automation YAML, so toggling one never edits the repo. */
export interface AutomationOverride {
  enabled?: boolean;
  channel?: string;
}

export interface UserConfig {
  version: 1;
  /** Set when onboarding (web, Mac or `npm run setup`) finished. Missing means both clients show the wizard. */
  onboardedAt?: string;
  user: SectionValues<'user'>;
  workspace: SectionValues<'workspace'>;
  integrations: SectionValues<'integrations'>;
  /** Where new threads run unless the composer picks another machine: a synced machine's sync id, or '' for this one. */
  runOn: { device: string };
  automations: Record<string, AutomationOverride>;
  /** This machine's worktree retention (apps/server/worktree-cleanup.ts). */
  worktrees: { retention: { enabled: boolean; idleDays: number } };
}

/** A partial update: any section, any subset of its fields. Null removes an automation override or onboardedAt. */
export interface UserConfigPatch {
  onboardedAt?: string | null;
  user?: Partial<UserConfig['user']>;
  workspace?: Partial<UserConfig['workspace']>;
  integrations?: Partial<UserConfig['integrations']>;
  runOn?: Partial<UserConfig['runOn']>;
  automations?: Record<string, AutomationOverride | null>;
}

/** GET and PUT /api/setup, POST /api/setup/complete. */
export interface SetupState {
  onboarded: boolean;
  /** Where the file lives, with ~ for the home folder. */
  path: string;
  /** The saved values. Empty strings mean the default. */
  config: UserConfig;
  /** What each value resolves to on the server's machine, defaults included. */
  resolved: { timezone: string; workspaceRoot: string; reposDir: string; centralBrainDir: string; hermesUrl: string };
  fallbacks: Record<SettingFallback, string> & { home: string };
  omniRepo: string | null;
  /** POST /api/setup/complete only: the #conductor thread holding the welcome message, on the first run. */
  threadId?: string | null;
}

// ---------- checks ----------

const FOLDER_BAD = /[\u0000-\u001f\u007f`$]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const URL = /^https?:\/\/\S+$/;

export const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Why a field's value is refused, or null. `file`: what a saved file must hold (length, safe folder text). `save`: a
 * value the server is asked to store, also checked for its format. `form`: a client's form, which also needs the
 * required fields. Values are trimmed first, as the server stores them.
 */
export function settingProblem(f: SettingField, raw: string, on: 'file' | 'save' | 'form'): string | null {
  const v = raw.trim();
  if (f.max !== undefined && v.length > f.max) return f.key === 'name' ? `Keep the name under ${f.max} characters.` : `${f.label}: keep it under ${f.max} characters.`;
  if (f.input === 'folder' && FOLDER_BAD.test(v)) return 'A folder path cannot contain control characters, backticks or $.';
  if (on === 'file') return null;
  if (!v) return on === 'form' ? (f.required ?? null) : null;
  switch (f.input) {
    case 'timezone':
      return isTimezone(v) ? null : 'Unknown timezone. Use an IANA name like Europe/Amsterdam.';
    case 'email':
      return EMAIL.test(v) ? null : 'Enter a valid email, or leave it empty.';
    case 'owner':
      return OWNER.test(v) ? null : 'A GitHub owner is a user or org name, like octocat.';
    case 'url':
      return URL.test(v) ? null : `${f.label}: use a URL like ${f.placeholder ?? 'https://example.com'}.`;
    default:
      return null;
  }
}

/** A field's hint with its machine default filled in. */
export const settingHint = (f: SettingField, fallbacks: Partial<Record<SettingFallback, string>>) =>
  f.hint?.replace('{fallback}', (f.fallback && fallbacks[f.fallback]) || '');

/** A field's placeholder: its own, else this machine's default. */
export const settingPlaceholder = (f: SettingField, fallbacks: Partial<Record<SettingFallback, string>>) =>
  f.placeholder ?? (f.fallback ? fallbacks[f.fallback] : undefined) ?? '';
