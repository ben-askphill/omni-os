import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { pageFields, SETTING_PAGES, settingHint, settingPlaceholder, settingProblem, type SettingField, type SettingPage } from '@omni/shared/settings.ts';
import { api, errorText, type SetupState, type UserConfig, type UserConfigPatch } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setChannelAlerts, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { PronounsInput, TimezoneInput } from '../components/Onboarding.tsx';
import { SettingsNav } from '../components/SettingsNav.tsx';
import { useTheme } from '../components/theme.tsx';
import { Button, ErrorNote, Icon, Loading, PageHeader, Segmented, StatusDot, Toggle } from '../components/ui.tsx';
import { navigate, SETTINGS_LABEL, settingsHash, useHash, type SettingsSection } from '../router.ts';
import { useApp } from '../store.tsx';
import { MachinesSection } from './Machines.tsx';
import { SecretsSection } from './Secrets.tsx';
import { Advanced, Card, Row, SwitchRow } from './settings-parts.tsx';

// Settings: one page with four sections, the same four as the Mac app's tabs and the phone's Settings list (#404).
// General: who you are, theme, notifications and running setup again. Workspace: your folders and integrations.
// Machines: this machine, where new threads run, Sync and Storage. Secrets: the keys the crew gets.
// General and Workspace edit the user config (data/omni.config.json) that onboarding wrote; the Mac app's General
// and Workspace tabs (apps/mac/Omni/ProfileSettingsView.swift) edit the same file.

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
      {state ? <ConfigForm part="general" state={state} onSaved={setState} /> : !error && <Loading />}
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

/**
 * General's You card, or Workspace's folders and integrations, drawn from the shared settings contract
 * (@omni/shared/settings.ts), so a new field there shows here with no change to this file. Each part saves its own
 * fields, so the other stays as it is.
 */
function ConfigForm({ part, state, onSaved }: { part: SettingPage; state: SetupState; onSaved: (s: SetupState) => void }) {
  const { reloadProfile } = useApp();
  const fields = useMemo(() => pageFields(part), [part]);
  const page = SETTING_PAGES[part];
  const [values, setValues] = useState(() => formValues(fields, state.config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The Mac app or `npm run setup` can change the file while this page is open.
  useEffect(() => setValues(formValues(fields, state.config)), [fields, state.config]);

  const patch = formPatch(fields, values);
  const dirty = JSON.stringify(patch) !== JSON.stringify(formPatch(fields, formValues(fields, state.config)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = fields.map((f) => settingProblem(f, values[fieldId(f)] ?? '', 'form')).find(Boolean);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.put<SetupState>('/setup', patch));
      if (part === 'general') await reloadProfile();
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const set = (f: SettingField) => (v: string) => (setValues((cur) => ({ ...cur, [fieldId(f)]: v })), setSaved(false));
  const rows = (list: readonly SettingField[]) =>
    pairHalves(list).map((group) =>
      group.length === 1 ? (
        <ConfigField key={fieldId(group[0])} field={group[0]} value={values[fieldId(group[0])] ?? ''} fallbacks={state.fallbacks} onChange={set(group[0])} />
      ) : (
        <div key={fieldId(group[0])} className="grid gap-4 sm:grid-cols-2">
          {group.map((f) => (
            <ConfigField key={fieldId(f)} field={f} value={values[fieldId(f)] ?? ''} fallbacks={state.fallbacks} onChange={set(f)} />
          ))}
        </div>
      ),
    );
  const advanced = fields.filter((f) => f.advanced);

  return (
    <form onSubmit={save} className="space-y-5">
      <Card title={page.title}>{rows(fields.filter((f) => !f.advanced))}</Card>
      {advanced.length > 0 && (
        <Advanced summary={page.advanced?.summary}>
          {page.advanced?.note && <p className="text-[12.5px] text-fg-3">{page.advanced.note}</p>}
          {rows(advanced)}
        </Advanced>
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

const fieldId = (f: SettingField) => `${f.section}.${f.key}`;

const formValues = (fields: readonly SettingField[], c: UserConfig): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [fieldId(f), (c[f.section] as Record<string, string | undefined>)[f.key] ?? f.default]));

/** The fields as PUT /api/setup takes them: trimmed, an empty one with a default (pronouns) back to it. */
function formPatch(fields: readonly SettingField[], values: Record<string, string>): UserConfigPatch {
  const patch: Partial<Record<SettingField['section'], Record<string, string>>> = {};
  for (const f of fields) (patch[f.section] ??= {})[f.key] = (values[fieldId(f)] ?? '').trim() || f.default;
  return patch;
}

/** Consecutive half-width fields share a row. */
function pairHalves(fields: readonly SettingField[]): SettingField[][] {
  const out: SettingField[][] = [];
  for (const f of fields) {
    const last = out.at(-1);
    if (f.half && last?.[0]?.half && last.length < 2) last.push(f);
    else out.push([f]);
  }
  return out;
}

const MONO = new Set<SettingField['input']>(['folder', 'url', 'owner']);
const NARROW = new Set<SettingField['input']>(['text', 'email', 'owner']);

function ConfigField({ field: f, value, fallbacks, onChange }: { field: SettingField; value: string; fallbacks: SetupState['fallbacks']; onChange: (v: string) => void }) {
  const id = `set-${f.key}`;
  const input =
    f.input === 'pronouns' ? (
      <PronounsInput id={id} value={value} onChange={onChange} />
    ) : f.input === 'timezone' ? (
      <TimezoneInput id={id} value={value} onChange={onChange} />
    ) : (
      <input
        id={id}
        className={`field w-full${NARROW.has(f.input) ? ' max-w-sm' : ''}${MONO.has(f.input) ? ' font-mono !text-[13px]' : ''}`}
        type={f.input === 'email' ? 'email' : 'text'}
        value={value}
        maxLength={f.max}
        autoComplete={f.autoComplete}
        placeholder={settingPlaceholder(f, fallbacks)}
        spellCheck={MONO.has(f.input) ? false : undefined}
        autoCapitalize={f.input === 'owner' ? 'off' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <Row label={f.label} htmlFor={id} hint={settingHint(f, fallbacks)}>
      {input}
    </Row>
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
      {/* One switch per channel grows with the sidebar, so the list folds shut like Advanced (#405). */}
      <Advanced title="Channels" summary={`${listed.filter((c) => !prefs.muted.includes(c.id)).length} of ${listed.length} notify`}>
        <div className={`space-y-3 ${prefs.enabled ? '' : 'pointer-events-none opacity-55'}`}>
          <p className="text-[12.5px] text-fg-3">A channel turned off still lists its results in Needs you, without a notification.</p>
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
      </Advanced>
    </Card>
  );
}
