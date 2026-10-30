import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText, type SetupState, type UserConfigPatch } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setChannelAlerts, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { NAME_MAX, PronounsInput, TimezoneInput } from '../components/Onboarding.tsx';
import { SettingsNav } from '../components/SettingsNav.tsx';
import { useTheme } from '../components/theme.tsx';
import { Button, ErrorNote, Icon, Loading, PageHeader, Segmented, StatusDot, Toggle } from '../components/ui.tsx';
import { navigate, SETTINGS_LABEL, settingsHash, useHash, type SettingsSection } from '../router.ts';
import { useApp } from '../store.tsx';
import { MachinesSection } from './Machines.tsx';
import { SecretsSection } from './Secrets.tsx';
import { Card, Row, SwitchRow } from './settings-parts.tsx';

// Settings: one page with four sections, the same four as the Mac app's tabs and the phone's Settings list (#404).
// General: who you are, theme, notifications and running setup again. Workspace: your folders and integrations.
// Machines: this machine, where new threads run, Sync and Storage. Secrets: the keys the crew gets.
// General and Workspace edit the user config (data/omni.config.json) that onboarding wrote; the Mac app's General
// and Workspace tabs (apps/mac/Omni/ProfileSettingsView.swift) edit the same file.

export { NAME_MAX };

const SUBTITLE: Record<SettingsSection, string> = {
  general: 'Who you are, how Omni looks in this browser, and what it tells you.',
  workspace: 'Where your work lives, and what Omni connects to.',
  machines: 'The machine Omni runs on, where new threads run, sync with your other machines, and the worktrees on disk.',
  secrets: 'API keys and tokens for the crew, stored outside the database.',
};

export function SettingsPage({ section }: { section?: SettingsSection }) {
  const current = section ?? 'general';
  // The pages Settings replaced (#/sync, #/storage, #/secrets) land here; the address becomes the section's own.
  const hash = useHash();
  useEffect(() => {
    if (section && hash.split('?')[0] !== settingsHash(section)) navigate(settingsHash(section), { replace: true });
  }, [hash, section]);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        width="max-w-2xl"
        title={
          <>
            <span className="md:hidden">{SETTINGS_LABEL[current]}</span>
            <span className="max-md:hidden">Settings</span>
          </>
        }
        subtitle={SUBTITLE[current]}
      >
        <SettingsNav section={current} className="mt-5" />
      </PageHeader>
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-2 pb-16 md:px-8">
        {current === 'general' && <GeneralSection />}
        {current === 'workspace' && <WorkspaceSection />}
        {current === 'machines' && <MachinesSection />}
        {current === 'secrets' && <SecretsSection />}
      </div>
    </div>
  );
}

/** The user config, read again when the setup wizard closes, since it may have changed everything. */
function useSetupState() {
  const { setupOpen } = useApp();
  const [state, setState] = useState<SetupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (setupOpen) return;
    api
      .get<SetupState>('/setup')
      .then(setState)
      .catch((err) => setError(errorText(err)));
  }, [setupOpen]);
  return { state, setState, error };
}

function GeneralSection() {
  const { openSetup } = useApp();
  const { state, setState, error } = useSetupState();
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {state ? <ConfigForm part="you" state={state} onSaved={setState} /> : !error && <Loading />}
      <AppearanceCard />
      <NotificationsCard />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-surface p-4 md:p-5">
        <div className="min-w-0">
          <div className="font-display text-[15px]">Setup</div>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Walk through the onboarding screens again, including the harness check.</p>
        </div>
        <Button onClick={openSetup}>Run setup again</Button>
      </div>
      <ConfigNote path={state?.path}>Appearance and notifications stay in this browser.</ConfigNote>
    </>
  );
}

function WorkspaceSection() {
  const { state, setState, error } = useSetupState();
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {state ? <ConfigForm part="workspace" state={state} onSaved={setState} /> : !error && <Loading />}
      <ConfigNote path={state?.path}>
        Server options such as the port and model defaults live in <code>.env</code>.
      </ConfigNote>
    </>
  );
}

function ConfigNote({ path, children }: { path?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
        <Icon name="info" size={15} />
      </span>
      <div>
        These settings live in <code>{path ?? 'data/omni.config.json'}</code> on this machine and never go into git, so a fork stays clean. {children}
      </div>
    </div>
  );
}

/** General's You card, or Workspace's folders and integrations. Each saves its own part of the config, so the other stays as it is. */
function ConfigForm({ part, state, onSaved }: { part: 'you' | 'workspace'; state: SetupState; onSaved: (s: SetupState) => void }) {
  const { reloadProfile } = useApp();
  const c = state.config;
  const [name, setName] = useState(c.user.name);
  const [pronouns, setPronouns] = useState(c.user.pronouns);
  const [email, setEmail] = useState(c.user.email);
  const [timezone, setTimezone] = useState(c.user.timezone);
  const [root, setRoot] = useState(c.workspace.root);
  const [reposDir, setReposDir] = useState(c.workspace.reposDir);
  const [githubOwner, setGithubOwner] = useState(c.workspace.githubOwner);
  const [hermesUrl, setHermesUrl] = useState(c.integrations.hermesUrl);
  const [centralBrainDir, setCentralBrainDir] = useState(c.integrations.centralBrainDir);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The Mac app or `npm run setup` can change the file while this page is open.
  useEffect(() => {
    setName(c.user.name);
    setPronouns(c.user.pronouns);
    setEmail(c.user.email);
    setTimezone(c.user.timezone);
    setRoot(c.workspace.root);
    setReposDir(c.workspace.reposDir);
    setGithubOwner(c.workspace.githubOwner);
    setHermesUrl(c.integrations.hermesUrl);
    setCentralBrainDir(c.integrations.centralBrainDir);
  }, [c]);

  const patch: UserConfigPatch =
    part === 'you'
      ? { user: { name: name.trim(), pronouns: pronouns.trim() || 'they/them', email: email.trim(), timezone: timezone.trim() } }
      : {
          workspace: { root: root.trim(), reposDir: reposDir.trim(), githubOwner: githubOwner.trim() },
          integrations: { hermesUrl: hermesUrl.trim(), centralBrainDir: centralBrainDir.trim() },
        };
  const current = part === 'you' ? { user: c.user } : { workspace: c.workspace, integrations: c.integrations };
  const dirty = JSON.stringify(patch) !== JSON.stringify(current);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (part === 'you') {
      if (!name.trim()) return setError('Enter a name.');
      if (name.trim().length > NAME_MAX) return setError(`Keep it under ${NAME_MAX} characters.`);
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.put<SetupState>('/setup', patch));
      if (part === 'you') await reloadProfile();
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const edited = () => setSaved(false);
  const field = (set: (v: string) => void) => (e: { target: { value: string } }) => (set(e.target.value), edited());

  return (
    <form onSubmit={save} className="space-y-5">
      {part === 'you' ? (
        <Card title="You">
          <Row label="Name" htmlFor="set-name" hint="Used in the greeting on Home and told to every agent, so a thread knows who it works for.">
            <input id="set-name" className="field w-full max-w-sm" value={name} maxLength={NAME_MAX} autoComplete="name" placeholder="Your name" onChange={field(setName)} />
          </Row>
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label="Pronouns" htmlFor="set-pronouns">
              <PronounsInput id="set-pronouns" value={pronouns} onChange={(v) => (setPronouns(v), edited())} />
            </Row>
            <Row label="Timezone" htmlFor="set-tz" hint={`Empty uses the server's: ${state.fallbacks.timezone}.`}>
              <TimezoneInput id="set-tz" value={timezone} onChange={(v) => (setTimezone(v), edited())} />
            </Row>
          </div>
          <Row label="Email" htmlFor="set-email">
            <input id="set-email" className="field w-full max-w-sm" type="email" value={email} autoComplete="email" placeholder="you@example.com" onChange={field(setEmail)} />
          </Row>
        </Card>
      ) : (
        <>
          <Card title="Workspace">
            <Row label="Workspace folder" htmlFor="set-root" hint="Threads without a repo run here; its CLAUDE.md and skills load in every Claude thread.">
              <input id="set-root" className="field w-full font-mono !text-[13px]" value={root} placeholder={state.fallbacks.workspaceRoot} spellCheck={false} onChange={field(setRoot)} />
            </Row>
            <Row label="Repos folder" htmlFor="set-repos">
              <input id="set-repos" className="field w-full font-mono !text-[13px]" value={reposDir} placeholder={state.fallbacks.reposDir} spellCheck={false} onChange={field(setReposDir)} />
            </Row>
            <Row label="GitHub owner" htmlFor="set-gh" hint="Your GitHub user or org.">
              <input id="set-gh" className="field w-full max-w-sm font-mono !text-[13px]" value={githubOwner} placeholder="octocat" spellCheck={false} autoCapitalize="off" onChange={field(setGithubOwner)} />
            </Row>
          </Card>
          <Card title="Integrations" subtitle="Optional. Leave a field empty to turn it off.">
            <Row label="Hermes URL" htmlFor="set-hermes" hint="A Hermes API server on your tailnet. Its token is the global secret HERMES_API_KEY.">
              <input id="set-hermes" className="field w-full font-mono !text-[13px]" value={hermesUrl} placeholder="http://100.64.0.1:8642" spellCheck={false} onChange={field(setHermesUrl)} />
            </Row>
            <Row label="Central brain folder" htmlFor="set-brain" hint="A git repo of notes that the brain-nightly automation exports thread digests into.">
              <input id="set-brain" className="field w-full font-mono !text-[13px]" value={centralBrainDir} placeholder="~/central-brain" spellCheck={false} onChange={field(setCentralBrainDir)} />
            </Row>
          </Card>
        </>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
          Save
        </Button>
        {saved && !dirty && <span className="text-[12.5px] text-fg-3">Saved</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  return (
    <Card title="Appearance" subtitle="Stays in this browser. For bigger or smaller text, use the browser's zoom (Cmd + and Cmd -).">
      <Segmented
        radio
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { id: 'system', icon: 'monitor', label: 'Match system' },
          { id: 'light', icon: 'sun', label: 'Light' },
          { id: 'dark', icon: 'moon', label: 'Dark' },
        ]}
      />
    </Card>
  );
}

const PERMISSION_GLYPH: Record<Permission, string> = { granted: 'done', denied: 'needs', default: 'settled', unsupported: 'settled' };

function NotificationsCard() {
  const { channels } = useApp();
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<Permission>(permissionNow);
  // Browser settings can change while the page is open; read again when Ben comes back to the tab.
  useEffect(() => {
    const check = () => setPermission(permissionNow());
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  const toggle = async (on: boolean) => setPermission(await setNotificationsEnabled(on));
  const listed = channels.filter((c) => !c.archived);

  return (
    <Card
      title="Notifications"
      subtitle="This browser can tell you when a thread finishes or fails while you are in another tab or app. Click one to open its thread. Nothing alerts for the thread you are looking at."
    >
      <SwitchRow
        title="Notify in this browser"
        detail="New finished and failed results, the ones Needs you lists. Turning this on asks the browser the first time. With the Mac app's notifications on too, you get both."
        checked={prefs.enabled}
        onChange={toggle}
        disabled={permission === 'unsupported'}
      />
      <div className="flex items-center gap-2 text-[13px]">
        <span className="w-20 shrink-0 text-fg-3">Browser</span>
        <StatusDot status={PERMISSION_GLYPH[permission]} size={7} />
        <span>{PERMISSION_LABEL[permission]}</span>
        {permission === 'default' && prefs.enabled && (
          <Button size="sm" className="ml-auto" onClick={() => void toggle(true)}>
            Ask the browser
          </Button>
        )}
      </div>
      {prefs.enabled && permission === 'denied' && (
        <ErrorNote>The browser blocks notifications for Omni. Allow them in the site settings (the icon left of the address), then come back.</ErrorNote>
      )}
      <div className={prefs.enabled ? '' : 'pointer-events-none opacity-55'}>
        <div className="caption mb-2">Channels</div>
        <p className="mb-2 text-[12.5px] text-fg-3">A channel turned off still lists its results in Needs you, without a notification.</p>
        {listed.length === 0 && <p className="text-[12.5px] text-fg-3">No channels yet.</p>}
        <div className="space-y-1.5">
          {listed.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-[16px] bg-bg px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{c.name}</div>
                <div className="truncate font-mono text-[11.5px] text-fg-3">#{c.id}</div>
              </div>
              <Toggle checked={!prefs.muted.includes(c.id)} onChange={(on) => setChannelAlerts(c.id, on)} label={`Notify for ${c.name}`} disabled={!prefs.enabled} />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
