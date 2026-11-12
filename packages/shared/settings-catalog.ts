// Settings' map: the sections, the groups the nav lists them in, and every setting a search can find. Desktop web,
// the phone's Settings screen and the desktop app all draw their nav from this, so they keep the same sections in the
// same order. packages/test-fixtures/settings-catalog.json records it (write it again with
// `npx tsx packages/shared/scripts/settings-catalog-fixture.ts`).
//
// Scope: a section marked `scoped` holds values a channel can set, so it shows the channel picker. "This machine"
// shows this machine's values; a channel shows what it sets and what it inherits. The pick stays from section to section.

export const SETTINGS_GROUPS = [
  { id: 'omni', title: '' },
  { id: 'agents', title: 'Agents' },
  { id: 'code', title: 'Code' },
  { id: 'connections', title: 'Connections' },
  { id: 'app', title: '' },
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id'];

export interface SettingsSectionDef {
  id: string;
  group: SettingsGroupId;
  title: string;
  /** An icon name in apps/web/src/components/ui/icons.tsx. */
  icon: string;
  /** One line under the title: what the section changes. */
  blurb: string;
  /** Shows the channel scope picker. */
  scoped?: boolean;
  /** Only in the desktop app (apps/desktop), where the Web UI has its bridge. A browser and the phone layout never list it. */
  desktopApp?: boolean;
}

/** In nav order. */
export const SETTINGS_SECTION_DEFS = [
  { id: 'general', group: 'omni', title: 'General', icon: 'sliders', blurb: 'Your name, pronouns, timezone and email, and the setup walkthrough.' },
  { id: 'appearance', group: 'omni', title: 'Appearance', icon: 'sun', blurb: 'How Omni looks and which keys it answers on this device.' },
  { id: 'notifications', group: 'omni', title: 'Notifications', icon: 'bell', blurb: 'What tells you a thread finished or failed.', scoped: true },
  { id: 'models', group: 'agents', title: 'Harnesses & models', icon: 'layers', blurb: 'Which agents can run, their models, and the model a new thread starts on.', scoped: true },
  { id: 'threads', group: 'agents', title: 'Threads', icon: 'message', blurb: 'Where new threads run and how they recover from a usage limit.' },
  { id: 'channels', group: 'code', title: 'Channels', icon: 'hash', blurb: 'Each channel’s name, default model, repo, notes and actions.', scoped: true },
  { id: 'workspace', group: 'code', title: 'Workspace', icon: 'folder', blurb: 'Where your work lives on this machine.' },
  { id: 'worktrees', group: 'code', title: 'Worktrees', icon: 'branch', blurb: 'The checkouts Omni makes for threads, and cleaning them up.' },
  { id: 'machines', group: 'connections', title: 'Machines', icon: 'monitor', blurb: 'Your machines, their connections and their updates.' },
  { id: 'sync', group: 'connections', title: 'Sync', icon: 'refresh', blurb: 'Your history across machines, through your own Cloudflare relay.' },
  { id: 'access', group: 'connections', title: 'Sharing & access', icon: 'lock', blurb: 'Who and what can reach this Omni.' },
  { id: 'secrets', group: 'connections', title: 'Secrets', icon: 'key', blurb: 'API keys and tokens for threads, kept outside the database.' },
  { id: 'desktop', group: 'app', title: 'Desktop app', icon: 'monitor', blurb: 'Quick Prompt and how this app starts.', desktopApp: true },
  { id: 'about', group: 'app', title: 'About', icon: 'info', blurb: 'Version, server and where Omni keeps its files.' },
] as const satisfies readonly SettingsSectionDef[];

export type SettingsSectionId = (typeof SETTINGS_SECTION_DEFS)[number]['id'];
export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTION_DEFS.map((s) => s.id);
export const isSettingsSectionId = (s: string | undefined | null): s is SettingsSectionId => (SETTINGS_SECTION_IDS as readonly string[]).includes(s ?? '');
export const sectionDef = (id: SettingsSectionId): SettingsSectionDef => SETTINGS_SECTION_DEFS.find((s) => s.id === id)!;
/** A group's sections in nav order. A desktop-app section only with `desktopApp`; every list says which it is. */
export const sectionsIn = (group: SettingsGroupId, opts: { desktopApp: boolean }): readonly SettingsSectionDef[] =>
  SETTINGS_SECTION_DEFS.filter((s: SettingsSectionDef) => s.group === group && (!s.desktopApp || opts.desktopApp));
/** Whether a section shows here: a desktop-app one only in the desktop app. */
export const sectionShows = (id: SettingsSectionId, desktopApp: boolean): boolean => desktopApp || !sectionDef(id).desktopApp;

/**
 * Old names that still open a section: the pages Settings replaced (#/sync, #/storage, #/secrets) and section
 * names from before this layout. A section keeps its own name. Integrations folded into Harnesses & models (Hermes)
 * and Workspace (the central brain folder) until it has third-party connections of its own.
 */
export const LEGACY_SETTINGS_SECTIONS: Record<string, SettingsSectionId> = {
  profile: 'general',
  quickPrompt: 'general',
  server: 'machines',
  connection: 'machines',
  storage: 'worktrees',
  integrations: 'models',
};

/** The section a name opens: its own, or the one an old name moved to. */
export const settingsSectionNamed = (name: string | undefined | null): SettingsSectionId | null =>
  isSettingsSectionId(name) ? name : name && Object.hasOwn(LEGACY_SETTINGS_SECTIONS, name) ? LEGACY_SETTINGS_SECTIONS[name] : null;

/** `desktop`: the Web UI in the desktop app (apps/desktop). It finds everything `web` does, and its own section. */
export type SettingsSurface = 'web' | 'desktop';

/** One thing a search finds. `id` is also the anchor a client scrolls to: `setting-<id>` on the web. */
export interface SettingsEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  keywords: readonly string[];
  /** Only on these surfaces. Unset: everywhere. */
  surfaces?: readonly SettingsSurface[];
  /** Only where this platform can do it: `loginItem`, an OS that opens apps at login (DesktopBridge.loginItemSupported). */
  needs?: 'loginItem';
}

/** What this platform can do, for the entries that say what they need. Unset: none of it. */
export interface SettingsCapabilities {
  loginItem?: boolean;
}

export const SETTINGS_ENTRIES = [
  { id: 'you', section: 'general', title: 'Name, pronouns, timezone and email', keywords: ['name', 'pronouns', 'timezone', 'time zone', 'email', 'greeting', 'profile'] },
  { id: 'setup', section: 'general', title: 'Run setup again', keywords: ['onboarding', 'wizard', 'harness check', 'first run'] },
  { id: 'theme', section: 'appearance', title: 'Theme', keywords: ['dark', 'light', 'system', 'mode', 'colors'] },
  { id: 'layout', section: 'appearance', title: 'New layout (Beta)', keywords: ['beta', 'layout', 'rail', 'sidebar', 'channel rail', 'classic', 'new ui', 'redesign'] },
  { id: 'inbox-key', section: 'appearance', title: 'Press I for the Inbox', keywords: ['keyboard', 'shortcut', 'key', 'inbox', 'i key', 'quick command'] },
  { id: 'zoom', section: 'appearance', title: 'Text size and zoom', keywords: ['zoom', 'scale', 'font size', 'text size', 'bigger', 'smaller'] },
  { id: 'notify', section: 'notifications', title: 'Notify on this device', keywords: ['alerts', 'finished', 'failed', 'desktop', 'permission', 'needs you'] },
  { id: 'notify-channels', section: 'notifications', title: 'Notifications per channel', keywords: ['mute', 'silence', 'channel'] },
  { id: 'harnesses', section: 'models', title: 'Harnesses', keywords: ['claude code', 'codex', 'cursor', 'hermes', 'cursor cloud', 'install', 'login', 'available', 'providers'] },
  { id: 'channel-model', section: 'models', title: 'Default model for new threads', keywords: ['auto', 'model', 'effort', 'reasoning', 'override', 'channel default'] },
  { id: 'concurrency', section: 'models', title: 'Turns at once per harness', keywords: ['max concurrent', 'queue', 'cap', 'parallel', 'limit'] },
  { id: 'hermes', section: 'models', title: 'Hermes URL', keywords: ['hermes', 'tailnet', 'HERMES_API_KEY', 'integrations'] },
  { id: 'model-options', section: 'models', title: 'Claude Code binary, fallback model and permission mode', keywords: ['OMNI_DEFAULT_MODEL', 'OMNI_PERMISSION_MODE', 'OMNI_CLAUDE_BIN', 'bypassPermissions', 'binary', 'path', '.env'] },
  { id: 'run-on', section: 'threads', title: 'Run new threads on', keywords: ['machine', 'device', 'where', 'remote', 'other mac'] },
  { id: 'keep-alive', section: 'threads', title: 'Keep sessions warm', keywords: ['keepalive', 'idle', 'process', 'background agents', 'interrupt'] },
  { id: 'limits', section: 'threads', title: 'Usage-limit recovery', keywords: ['rate limit', 'usage limit', 'reset', 'continue', 'resume', 'grace'] },
  { id: 'thread-features', section: 'threads', title: 'Reply suggestions, turn snapshots, browser and uploads', keywords: ['suggestions', 'haiku', 'snapshots', 'this turn', 'diff', 'browser', 'playwright', 'chrome', 'uploads', 'attachments', 'mods', 'plugins'] },
  { id: 'automations', section: 'threads', title: 'Automations', keywords: ['scheduled', 'schedule', 'cron', 'webhook', 'tasks', 'recurring'] },
  { id: 'channel-list', section: 'channels', title: 'Channels', keywords: ['projects', 'clients', 'new channel', 'archive'] },
  { id: 'channel-basics', section: 'channels', title: 'Channel name, icon, notes and design system', keywords: ['emoji', 'kind', 'notes', 'system prompt', 'instructions', 'design system'] },
  { id: 'channel-code', section: 'channels', title: 'Channel repo and browser', keywords: ['repo path', 'github repo', 'git', 'browser window', 'headless', 'store domain', 'shopify'] },
  { id: 'channel-actions', section: 'channels', title: 'Channel actions', keywords: ['commands', 'scripts', 'setup', 'port', 'preview', 'dev server'] },
  { id: 'folders', section: 'workspace', title: 'Workspace folder, repos folder and GitHub owner', keywords: ['workspace', 'repos', 'folder', 'github owner', 'org', 'CLAUDE.md', 'skills', 'base directory'] },
  { id: 'brain', section: 'workspace', title: 'Central brain folder', keywords: ['notes', 'brain-nightly', 'export', 'digests'] },
  { id: 'worktree-retention', section: 'worktrees', title: 'Automatic cleanup', keywords: ['retention', 'idle days', 'delete', 'prune', 'cleanup'] },
  { id: 'worktree-storage', section: 'worktrees', title: 'Worktree storage', keywords: ['disk', 'size', 'scan', 'storage', 'eligible'] },
  { id: 'worktree-slim', section: 'worktrees', title: 'Strip caches', keywords: ['node_modules', 'build output', 'cache', 'free space', 'slim', 'disk'] },
  { id: 'this-machine', section: 'machines', title: 'Current machine', keywords: ['name', 'device', 'hostname', 'feed', 'address'] },
  { id: 'update-machines', section: 'machines', title: 'Your machines and updates', keywords: ['update', 'upgrade', 'version', 'download', 'restart', 'devices', 'fleet', 'every machine', 'check for updates'] },
  { id: 'sync-status', section: 'sync', title: 'Sync sign-in and status', keywords: ['relay', 'cloudflare', 'worker', 'pause', 'sync now', 'pending'] },
  { id: 'path-map', section: 'sync', title: 'Path map', keywords: ['folders', 'paths', 'other machine', 'map'] },
  { id: 'google', section: 'access', title: 'Google account and signed-in devices', keywords: ['sign in', 'owner', 'devices', 'revoke', 'sessions', 'phone', 'permissions'] },
  { id: 'ios', section: 'access', title: 'Omni for iOS', keywords: ['iphone', 'ipad', 'qr', 'pair', 'app'] },
  { id: 'connect', section: 'access', title: 'Omni Connect', keywords: ['tunnel', 'cloudflared', 'remote', 'phone', 'other machines'] },
  { id: 'network', section: 'access', title: 'Tailscale logins and public MCP URL', keywords: ['tailscale', 'tailnet', 'serve', 'mcp', 'claude.ai', 'chatgpt', 'clerk', 'remote access'] },
  { id: 'secrets', section: 'secrets', title: 'Secrets', keywords: ['api key', 'token', 'env', 'keychain', 'password', 'credentials', 'grok bot'] },
  { id: 'desktop-quick-prompt', section: 'desktop', title: 'Quick Prompt', keywords: ['hotkey', 'shortcut', 'keyboard', 'global', 'launcher', 'wispr flow', 'dictate'], surfaces: ['desktop'] },
  { id: 'desktop-login', section: 'desktop', title: 'Open Omni at login', keywords: ['startup', 'launch', 'login items', 'autostart'], surfaces: ['desktop'], needs: 'loginItem' },
  { id: 'desktop-updates', section: 'machines', title: 'App version and updates', keywords: ['version', 'update', 'upgrade', 'relaunch', 'restart', 'release notes', 'download', 'automatic', 'check for updates'], surfaces: ['desktop'] },
  { id: 'server', section: 'about', title: 'Server address, port and log', keywords: ['port', 'host', 'address', 'node', 'log', 'OMNI_PORT', 'data folder'] },
  { id: 'version', section: 'about', title: 'Version and build', keywords: ['version', 'commit', 'build', 'update', 'release'] },
  { id: 'files', section: 'about', title: 'Where Omni keeps its files', keywords: ['data folder', 'config file', 'omni.config.json', 'secret store', 'logs'] },
] as const satisfies readonly SettingsEntry[];

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
/** The words of a title or keyword: split on spaces, commas, hyphens, slashes and ampersands. */
const words = (s: string) => s.split(/[\s,\-/&]+/).filter(Boolean);

/**
 * The entries a search finds on a surface, best first: a title that starts with the query, then a title word that
 * does, then a title, keyword or section title that holds it. Each word of the query has to match somewhere. Ties
 * keep nav order.
 */
export function searchSettings(query: string, surface: SettingsSurface, can: SettingsCapabilities = {}): SettingsEntry[] {
  const asked = words(fold(query));
  if (!asked.length) return [];
  const scored: { e: SettingsEntry; score: number; i: number }[] = [];
  const order = (e: SettingsEntry) => SETTINGS_SECTION_IDS.indexOf(e.section) * 100;
  SETTINGS_ENTRIES.forEach((e: SettingsEntry, i) => {
    if (e.surfaces && !e.surfaces.includes(surface) && !(surface === 'desktop' && e.surfaces.includes('web'))) return;
    if (e.needs && !can[e.needs]) return;
    const title = fold(e.title);
    const section = fold(sectionDef(e.section).title);
    const keys = e.keywords.map(fold);
    let score = 0;
    for (const w of asked) {
      if (title.startsWith(w)) score += 4;
      else if (words(title).some((t) => t.startsWith(w))) score += 3;
      else if (keys.some((k) => words(k).some((t) => t.startsWith(w)))) score += 2;
      else if (title.includes(w) || section.includes(w) || keys.some((k) => k.includes(w))) score += 1;
      else return;
    }
    scored.push({ e, score, i: order(e) + i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.e);
}

// ---------- where a value comes from ----------

/**
 * Where a shown value comes from, the label beside it. `default`: Omni's built-in value. `env`: an environment
 * variable or `.env` line, which wins over the config file. `machine`: this machine's data/omni.config.json.
 * `channel`: set on the channel in scope. `inherited`: the channel has none of its own, so this machine's applies.
 * `device`: kept by this browser or this app only. `mixed`: channels differ (shown at This machine).
 */
export type Provenance = 'default' | 'env' | 'machine' | 'channel' | 'inherited' | 'device' | 'mixed';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  default: 'Built-in default',
  env: '.env',
  machine: 'This machine',
  channel: 'This channel',
  inherited: 'Inherited',
  device: 'This device',
  mixed: 'Mixed across channels',
};

/** Whether a reset beside the value can clear it: only what Omni itself saved. */
export const resettable = (p: Provenance) => p === 'machine' || p === 'channel';
