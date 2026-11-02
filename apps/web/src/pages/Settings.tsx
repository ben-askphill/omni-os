import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { sectionDef, sectionShows, type Provenance } from '@omni/shared/settings-catalog.ts';
import { pageFields, SETTING_PAGES, settingHint, settingId, settingPlaceholder, settingProblem, type SettingField, type SettingPage } from '@omni/shared/settings.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type SetupState, type Status, type UserConfig, type UserConfigPatch } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setChannelAlerts, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { ChannelActionsEditor } from '../components/ChannelActionsEditor.tsx';
import { PronounsInput, TimezoneInput } from '../components/Onboarding.tsx';
import { SettingsNav } from '../components/SettingsNav.tsx';
import { useTheme } from '../components/theme.tsx';
import { desktop } from '../desktop.ts';
import { Avatar, Button, Chip, ErrorNote, Icon, LinkButton, Loading, PageHeader, Segmented, StatusDot, Toggle } from '../components/ui.tsx';
import { href, navigate, settingsHash, useHash, type SettingsSection } from '../router.ts';
import { setSettingsScope } from '../settings-scope.ts';
import { useApp, useSecretStoreLabel } from '../store.tsx';
import { ChannelSettingsForm, Section } from './ChannelSettings.tsx';
import { GoogleAccountSection } from './GoogleAccount.tsx';
import { ConnectSection } from './Connect.tsx';
import { IosPairingSection } from './IosPairing.tsx';
import { MachinesSection, RunOnCard } from './Machines.tsx';
import { SecretsSection } from './Secrets.tsx';
import { DesktopSection } from './SettingsDesktop.tsx';
import { ModelsSection } from './SettingsAgents.tsx';
import { StorageSection } from './Storage.tsx';
import { PathMapEditor, SyncSection } from './Sync.tsx';
import { Advanced, Card, InfoRow, Origin, Row, ScopeBar, ServerOptions, settingAnchor, SwitchRow, useScopedChannel } from './settings-parts.tsx';

// Settings: a searchable nav of grouped sections beside one section at a time (@omni/shared/settings-catalog.ts),
// the same sections in the same order as the phone's Settings screen and the Mac app's Settings window. A scoped
// section shows the channel picker: Every channel is this machine's values, a channel shows what it sets and what it
// inherits. Each value says where it comes from (built-in default, .env, this machine, the channel, this device),
// with Reset beside one Omni saved. Config fields come from the shared contract (@omni/shared/settings.ts) and save
// to data/omni.config.json through PUT /api/setup, as the Mac app's ProfileSettingsView.swift does.

export function SettingsPage({ section, focus }: { section?: SettingsSection; focus?: string }) {
  // The desktop app's own section is no page in a browser or on a phone.
  const current = section && sectionShows(section, desktop !== null) ? section : 'general';
  const def = sectionDef(current);
  // The pages Settings replaced (#/sync, #/storage, #/secrets) and old section names land here; the address becomes the section's own.
  const hash = useHash();
  useEffect(() => {
    if (section && hash.split('?')[0] !== settingsHash(current)) navigate(settingsHash(current, current === section ? focus : undefined), { replace: true });
  }, [hash, section, current, focus]);
  useFocus(current, focus);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[64rem] gap-6 md:px-4 lg:gap-10">
        <aside className="sticky top-0 hidden max-h-screen w-56 shrink-0 self-start overflow-y-auto pt-10 pb-10 md:block">
          <SettingsNav section={current} />
        </aside>
        <div className="min-w-0 max-w-2xl flex-1">
          <PageHeader eyebrow={<span className="max-md:hidden">Settings</span>} title={def.title} subtitle={def.blurb}>
            {def.scoped && (
              <div className="mt-4">
                <ScopeBar />
              </div>
            )}
          </PageHeader>
          <div className="space-y-5 px-4 pt-2 pb-16 md:px-8">
            <SectionBody section={current} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBody({ section }: { section: SettingsSection }) {
  const { channel } = useScopedChannel();
  switch (section) {
    case 'general':
      return <GeneralSection />;
    case 'appearance':
      return <AppearanceCard />;
    case 'notifications':
      return <NotificationsCard scoped={channel?.id} />;
    case 'models':
      return <ModelsSection />;
    case 'threads':
      return <ThreadsSection />;
    case 'channels':
      return <ChannelsSection />;
    case 'workspace':
      return <WorkspaceSection />;
    case 'worktrees':
      return <WorktreesSection />;
    case 'machines':
      return <MachinesSection />;
    case 'sync':
      return (
        <>
          <SyncSection />
          <Advanced summary="Where your folders are on your other machines">
            <div id={settingAnchor('path-map')} className="scroll-mt-6">
              <PathMapEditor />
            </div>
          </Advanced>
        </>
      );
    case 'access':
      return <AccessSection />;
    case 'integrations':
      return <ConfigSection part="integrations" />;
    case 'secrets':
      return (
        <div id={settingAnchor('secrets')} className="scroll-mt-6 space-y-5">
          <SecretsSection scoped={channel?.id} />
        </div>
      );
    case 'desktop':
      return desktop ? <DesktopSection bridge={desktop} /> : null;
    case 'about':
      return <AboutSection />;
  }
}

/** A search result's entry: scroll to it once it renders (cards that load data appear late) and flash it. */
function useFocus(section: string, focus: string | undefined) {
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(settingAnchor(focus));
      if (el || ++tries > 20) clearInterval(t);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.animate([{ boxShadow: '0 0 0 2px var(--live)' }, { boxShadow: '0 0 0 2px transparent' }], { duration: 1600, easing: 'ease-out' });
    }, 100);
    return () => clearInterval(t);
  }, [section, focus]);
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
  return (
    <>
      <ConfigSection part="general" />
      <div id={settingAnchor('setup')} className="flex scroll-mt-6 flex-wrap items-center justify-between gap-3 rounded-[20px] bg-surface p-4 md:p-5">
        <div className="min-w-0">
          <div className="font-display text-[15px]">Setup</div>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Walk through the onboarding screens again, including the harness check.</p>
        </div>
        <Button onClick={openSetup}>Run setup again</Button>
      </div>
    </>
  );
}

/** One page of config fields, with the note on where they live. */
function ConfigSection({ part, children }: { part: SettingPage; children?: ReactNode }) {
  const { state, setState, error } = useSetupState();
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {state ? <ConfigForm part={part} state={state} onSaved={setState} /> : !error && <Loading />}
      {children}
      {part !== 'access' && <ConfigNote path={state?.path} />}
    </>
  );
}

function WorkspaceSection() {
  const { channel } = useScopedChannel();
  const setup = useApi<SetupState>(channel ? '/setup' : null);
  return (
    <>
      {channel && (
        <Card entry="folders" title={`Where #${channel.name}'s threads run`} subtitle="A channel with a repo runs each thread in a worktree of it; without one, in its base directory, else your workspace folder.">
          {channel.repo_path ? (
            <Row label="Repo" htmlFor="ws-repo" origin={<Origin of="channel" label={`Set on #${channel.name}`} />}>
              <div id="ws-repo" className="font-mono text-[12.5px] break-all">{channel.repo_path}</div>
            </Row>
          ) : channel.base_dir ? (
            <Row label="Base directory" htmlFor="ws-base" origin={<Origin of="channel" label={`Set on #${channel.name}`} />}>
              <div id="ws-base" className="font-mono text-[12.5px] break-all">{channel.base_dir}</div>
            </Row>
          ) : (
            <Row label="Base directory" htmlFor="ws-base" origin={<Origin of="inherited" label="Inherited: workspace folder" />}>
              <div id="ws-base" className="font-mono text-[12.5px] break-all text-fg-2">{setup.data?.resolved.workspaceRoot ?? '…'}</div>
            </Row>
          )}
          <div>
            <Button size="sm" onClick={() => navigate(href.settingsSection('channels', 'channel-code'))}>
              Change in Channels
            </Button>
          </div>
        </Card>
      )}
      <ConfigSection part="workspace" />
    </>
  );
}

function WorktreesSection() {
  const { channel } = useScopedChannel();
  return (
    <>
      {channel && (
        <Card
          title={`Worktrees in #${channel.name}`}
          subtitle={channel.repo_path ? 'Each new thread gets its own git worktree and branch, so threads never share a checkout.' : 'This channel has no repo, so its threads run in a folder and get no worktree.'}
          origin={channel.repo_path ? <Origin of="channel" label={`Set on #${channel.name}`} /> : undefined}
        >
          {channel.repo_path && (
            <div className="flex items-center gap-3 text-[13px]">
              <span className="flex-1">Worktree per thread</span>
              <span className="text-fg-2">{channel.use_worktree ? 'On' : 'Off'}</span>
              <Button size="sm" onClick={() => navigate(href.settingsSection('channels', 'channel-code'))}>
                Change
              </Button>
            </div>
          )}
          <p className="text-[12px] text-fg-3">Cleanup below is per machine. A channel cannot set its own yet.</p>
        </Card>
      )}
      <div id={settingAnchor('worktree-retention')} className="scroll-mt-6 space-y-5">
        <span id={settingAnchor('worktree-storage')} />
        <StorageSection />
      </div>
      <ServerOptions section="worktrees" />
    </>
  );
}

function ThreadsSection() {
  const { state } = useSetupState();
  return (
    <>
      <RunOnCard state={state} />
      <div id={settingAnchor('keep-alive')} className="scroll-mt-6">
        <span id={settingAnchor('limits')} />
        <span id={settingAnchor('thread-features')} />
        <ServerOptions section="threads" title="Sessions, usage limits and thread features" />
      </div>
      <Card
        entry="automations"
        title="Automations"
        subtitle="Threads that start on a schedule, a GitHub event or a webhook. They have a page of their own."
        origin={<LinkButton size="sm" href={href.automations()} icon="zap">Open Automations</LinkButton>}
      >
        {null}
      </Card>
    </>
  );
}

function ChannelsSection() {
  const { channels } = useApp();
  const { channel } = useScopedChannel();
  if (channel)
    return (
      <>
        <div id={settingAnchor('channel-basics')} className="scroll-mt-6">
          <span id={settingAnchor('channel-code')} />
          <ChannelSettingsForm key={channel.id} existing={channel} />
        </div>
        <div id={settingAnchor('channel-actions')} className="scroll-mt-6">
          <Section title="Actions">
            <ChannelActionsEditor channelId={channel.id} />
          </Section>
        </div>
      </>
    );
  const listed = channels.filter((c) => !c.archived);
  const archived = channels.filter((c) => c.archived);
  return (
    <Card entry="channel-list" title="Your channels" subtitle="One per client or project. Pick one to see and change its settings; it stays picked as you move between sections." origin={<LinkButton size="sm" href={href.newChannel()} icon="plus">New channel</LinkButton>}>
      <ul className="divide-y divide-line">
        {listed.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setSettingsScope(c.id)} className="flex w-full min-w-0 items-center gap-3 py-2.5 text-left">
              <Avatar name={c.name} channelIcon={c.icon} icon={c.id === 'conductor' ? 'target' : undefined} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px]">{c.id === 'conductor' ? 'Conductor' : `#${c.name}`}</div>
                <div className="truncate font-mono text-[11.5px] text-fg-3">{c.repo_path ?? c.base_dir ?? 'Workspace folder'}</div>
              </div>
              <Icon name="chevronRight" size={14} className="text-fg-3" />
            </button>
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <Advanced title="Archived" summary={`${archived.length}`}>
          <ul className="space-y-1">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">#{c.name}</span>
                <LinkButton size="sm" href={href.channel(c.id)}>
                  Open to unarchive
                </LinkButton>
              </li>
            ))}
          </ul>
        </Advanced>
      )}
    </Card>
  );
}

function AccessSection() {
  return (
    <>
      <div id={settingAnchor('google')} className="scroll-mt-6 space-y-5">
        <GoogleAccountSection />
      </div>
      <div id={settingAnchor('connect')} className="scroll-mt-6 space-y-5">
        <ConnectSection />
      </div>
      <IosPairingSection />
      <ConfigSection part="access" />
    </>
  );
}

function AboutSection() {
  // The store keeps only what the sidebar needs from /status, so read the server's build here.
  const status = useApi<Status>('/status');
  const setup = useApi<SetupState>('/setup');
  const store = useSecretStoreLabel();
  const s = status.data?.server;
  return (
    <>
      <Card entry="version" title="Version and build">
        <div className="space-y-2 text-[13px]">
          <InfoRow label="Version">
            <span className="font-num">{s?.version ?? '…'}</span>
          </InfoRow>
          <InfoRow label="Commit">
            <span className="truncate font-mono text-[12.5px]">{s?.gitHead?.slice(0, 12) ?? 'Unknown'}</span>
          </InfoRow>
          {s?.startedAt && (
            <InfoRow label="Started">
              <span>{relTime(s.startedAt)}</span>
            </InfoRow>
          )}
        </div>
      </Card>
      <Card entry="files" title="Where Omni keeps its files" subtitle="All on this machine. None of it goes into git.">
        <div className="space-y-2 text-[13px]">
          <InfoRow label="Repo">
            <span className="truncate font-mono text-[12.5px]">{s?.root ?? '…'}</span>
          </InfoRow>
          <InfoRow label="Data">
            <span className="truncate font-mono text-[12.5px]">{s?.dataDir ?? '…'}</span>
          </InfoRow>
          <InfoRow label="Config">
            <span className="truncate font-mono text-[12.5px]">{setup.data?.path ?? 'data/omni.config.json'}</span>
          </InfoRow>
          <InfoRow label="Secrets">
            <span className="truncate">{store}</span>
          </InfoRow>
        </div>
      </Card>
    </>
  );
}

function ConfigNote({ path }: { path?: string }) {
  return (
    <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
        <Icon name="info" size={15} />
      </span>
      <div>
        These settings live in <code>{path ?? 'data/omni.config.json'}</code> on this machine and never go into git, so a fork stays clean. An environment variable in{' '}
        <code>.env</code> wins over a value here; the chip beside a field says so.
      </div>
    </div>
  );
}

/** Where a config field's value comes from now. */
function fieldOrigin(f: SettingField, state: SetupState): { of: Provenance; label?: string } {
  const env = state.env?.[settingId(f)];
  if (env) return { of: 'env', label: `Set by ${env}` };
  const saved = (state.config[f.section] as Record<string, string | undefined>)[f.key] ?? '';
  return saved && saved !== f.default ? { of: 'machine' } : { of: 'default' };
}

/**
 * One section's config fields, drawn from the shared settings contract (@omni/shared/settings.ts), so a new field
 * there shows here with no change to this file. Each section saves its own fields, so the others stay as they are.
 * Reset beside a field saves its default at once and keeps the other drafts.
 */
function ConfigForm({ part, state, onSaved }: { part: SettingPage; state: SetupState; onSaved: (s: SetupState) => void }) {
  const { reloadProfile } = useApp();
  const fields = useMemo(() => pageFields(part), [part]);
  const editable = useMemo(() => fields.filter((f) => !f.readonly), [fields]);
  const page = SETTING_PAGES[part];
  const [values, setValues] = useState(() => formValues(fields, state.config));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The Mac app, a reset or `npm run setup` can change the file while this page is open. A field still as it was
  // saved follows the file; one being edited keeps its draft.
  const base = useRef(values);
  useEffect(() => {
    const next = formValues(fields, state.config);
    setValues((cur) => Object.fromEntries(Object.keys(next).map((k) => [k, cur[k] === base.current[k] ? next[k] : cur[k]])));
    base.current = next;
  }, [fields, state.config]);

  const patch = formPatch(editable, values);
  const dirty = JSON.stringify(patch) !== JSON.stringify(formPatch(editable, formValues(editable, state.config)));

  const after = async (next: SetupState) => {
    onSaved(next);
    if (part === 'general') await reloadProfile();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = editable.map((f) => settingProblem(f, values[settingId(f)] ?? '', 'form')).find(Boolean);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await after(await api.put<SetupState>('/setup', patch));
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = async (f: SettingField) => {
    setResetting(settingId(f));
    setError(null);
    try {
      await after(await api.put<SetupState>('/setup', { [f.section]: { [f.key]: f.default } }));
      setValues((cur) => ({ ...cur, [settingId(f)]: f.default }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setResetting(null);
    }
  };

  const set = (f: SettingField) => (v: string) => (setValues((cur) => ({ ...cur, [settingId(f)]: v })), setSaved(false));
  const field = (f: SettingField) => {
    const o = fieldOrigin(f, state);
    return (
      <ConfigField
        key={settingId(f)}
        field={f}
        value={values[settingId(f)] ?? ''}
        fallbacks={state.fallbacks}
        onChange={set(f)}
        origin={<Origin of={o.of} label={o.label} onReset={f.readonly || f.required ? undefined : () => void reset(f)} busy={resetting === settingId(f)} />}
      />
    );
  };
  const rows = (list: readonly SettingField[]) =>
    pairHalves(list).map((group) =>
      group.length === 1 ? (
        field(group[0])
      ) : (
        <div key={settingId(group[0])} className="grid gap-4 sm:grid-cols-2">
          {group.map(field)}
        </div>
      ),
    );
  const advanced = fields.filter((f) => f.advanced);
  const entry = FORM_ENTRY[part];

  return (
    <form onSubmit={save} className="space-y-5">
      <div id={settingAnchor(entry)} className="scroll-mt-6">
        {part === 'integrations' && <span id={settingAnchor('brain')} />}
        <Card title={page.title} subtitle={page.note}>
          {rows(fields.filter((f) => !f.advanced))}
        </Card>
      </div>
      {advanced.length > 0 && (
        <Advanced summary={page.advanced?.summary}>
          {page.advanced?.note && <p className="text-[12.5px] text-fg-3">{page.advanced.note}</p>}
          {rows(advanced)}
        </Advanced>
      )}
      {editable.length > 0 && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
            Save
          </Button>
          {saved && !dirty && <span className="text-[12.5px] text-fg-3">Saved</span>}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}

/** The search entry each form answers to. */
const FORM_ENTRY: Record<SettingPage, string> = { general: 'you', workspace: 'folders', integrations: 'hermes', access: 'network' };

const formValues = (fields: readonly SettingField[], c: UserConfig): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [settingId(f), (c[f.section] as Record<string, string | undefined>)[f.key] ?? f.default]));

/** The fields as PUT /api/setup takes them: trimmed, an empty one with a default (pronouns) back to it. */
function formPatch(fields: readonly SettingField[], values: Record<string, string>): UserConfigPatch {
  const patch: Partial<Record<SettingField['section'], Record<string, string>>> = {};
  for (const f of fields) (patch[f.section] ??= {})[f.key] = (values[settingId(f)] ?? '').trim() || f.default;
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

function ConfigField({
  field: f,
  value,
  fallbacks,
  onChange,
  origin,
}: {
  field: SettingField;
  value: string;
  fallbacks: SetupState['fallbacks'];
  onChange: (v: string) => void;
  origin: ReactNode;
}) {
  const id = `set-${f.key}`;
  const input = f.readonly ? (
    <input id={id} className={`field w-full font-mono !text-[13px] text-fg-2`} value={value} placeholder={settingPlaceholder(f, fallbacks) || 'Not set'} readOnly aria-readonly />
  ) : f.input === 'pronouns' ? (
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
    <Row label={f.label} htmlFor={id} hint={settingHint(f, fallbacks)} origin={origin}>
      {input}
    </Row>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  return (
    <>
      <Card entry="theme" title="Theme" subtitle="Follows your system, or stays light or dark." origin={<Origin of="device" label="This browser only" />}>
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
      {desktop ? (
        <Card
          entry="zoom"
          title="Text size"
          subtitle="This app has its own zoom, in Desktop app and in the View menu."
          origin={<LinkButton size="sm" href={href.settingsSection('desktop', 'desktop-zoom')}>Open Desktop app</LinkButton>}
        >
          {null}
        </Card>
      ) : (
        <Card entry="zoom" title="Text size" subtitle="For bigger or smaller text, use the browser's zoom (Cmd + and Cmd -). The Mac app has its own." origin={<Origin of="device" label="This browser only" />}>
          {null}
        </Card>
      )}
    </>
  );
}

const PERMISSION_GLYPH: Record<Permission, string> = { granted: 'done', denied: 'needs', default: 'settled', unsupported: 'settled' };

function NotificationsCard({ scoped }: { scoped?: string }) {
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
  const inScope = listed.find((c) => c.id === scoped);
  const channelRow = (c: (typeof listed)[number]) => (
    <div key={c.id} className="flex items-center gap-3 rounded-[16px] bg-bg px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{c.name}</div>
        <div className="truncate font-mono text-[11.5px] text-fg-3">#{c.id}</div>
      </div>
      <Toggle checked={!prefs.muted.includes(c.id)} onChange={(on) => setChannelAlerts(c.id, on)} label={`Notify for ${c.name}`} disabled={!prefs.enabled} />
    </div>
  );

  return (
    <>
      <Card
        entry="notify"
        title="Notify on this device"
        subtitle="This browser can tell you when a thread finishes or fails while you are in another tab or app. Click one to open its thread. Nothing alerts for the thread you are looking at."
        origin={<Origin of="device" label="This browser only" />}
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
      </Card>
      {inScope ? (
        <Card
          entry="notify-channels"
          title={`#${inScope.name}`}
          subtitle="A channel turned off still lists its results in Needs you, without a notification."
          origin={<Chip tone={prefs.muted.includes(inScope.id) ? 'outline' : 'default'}>{prefs.muted.includes(inScope.id) ? 'Muted on this browser' : 'Notifies'}</Chip>}
        >
          <div className={prefs.enabled ? '' : 'pointer-events-none opacity-55'}>{channelRow(inScope)}</div>
        </Card>
      ) : (
        // One switch per channel grows with the sidebar, so the list folds shut like Advanced (#405).
        <div id={settingAnchor('notify-channels')} className="scroll-mt-6">
          <Advanced title="Channels" summary={`${listed.filter((c) => !prefs.muted.includes(c.id)).length} of ${listed.length} notify`}>
            <div className={`space-y-3 ${prefs.enabled ? '' : 'pointer-events-none opacity-55'}`}>
              <p className="text-[12.5px] text-fg-3">A channel turned off still lists its results in Needs you, without a notification.</p>
              {listed.length === 0 && <p className="text-[12.5px] text-fg-3">No channels yet.</p>}
              <div className="space-y-1.5">{listed.map(channelRow)}</div>
            </div>
          </Advanced>
        </div>
      )}
    </>
  );
}
