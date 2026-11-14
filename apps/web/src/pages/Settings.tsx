import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { sectionDef, sectionShows, type Provenance } from '@omni/shared/settings-catalog.ts';
import { pageFields, SETTING_PAGES, settingHint, settingId, settingPlaceholder, settingProblem, type SettingField, type SettingPage } from '@omni/shared/settings.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi, type SetupState, type Status, type UserConfig, type UserConfigPatch } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setChannelAlerts, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { ChannelActionsEditor } from '../components/ChannelActionsEditor.tsx';
import { PRONOUNS } from '../components/onboarding-parts.tsx';
import { SettingsNav } from '../components/SettingsNav.tsx';
import { useTheme } from '../components/theme.tsx';
import { setLayout, setRailColor, useLayout, useRailColor } from '../layout-pref.ts';
import { setInboxKeyOn, useInboxKeyOn } from '../inbox-key.ts';
import { desktop } from '../desktop.ts';
import { Avatar, Button, Chip, ErrorNote, Icon, LinkButton, Loading, PageHeader, Picker, Segmented, StatusDot } from '../components/ui.tsx';
import { href, navigate, settingsHash, useHash, type SettingsSection } from '../router.ts';
import { setSettingsScope } from '../settings-scope.ts';
import { useApp, useIsMobile, useSecretStoreLabel } from '../store.tsx';
import { ChannelSettingsForm } from './ChannelSettings.tsx';
import { GoogleAccountSection } from './GoogleAccount.tsx';
import { InstallTokenCard, McpClientsCard, RefusedChangesCard, SyncKeysCard } from './SecuritySettings.tsx';
import { ConnectSection } from './Connect.tsx';
import { IosPairingSection } from './IosPairing.tsx';
import { MachinesSection, RunOnCard } from './Machines.tsx';
import { SecretsSection } from './Secrets.tsx';
import { AppServerRows, DesktopSection, ZoomRow } from './SettingsDesktop.tsx';
import { ModelsSection } from './SettingsAgents.tsx';
import { StorageSection } from './Storage.tsx';
import { PathMapEditor, SyncSection } from './Sync.tsx';
import {
  Advanced,
  AutosaveNote,
  Card,
  EnvNote,
  FootNote,
  InfoList,
  InfoRow,
  LinkLine,
  Origin,
  ResetButton,
  Row,
  rowHintId,
  ScopeBar,
  ServerOptions,
  settingAnchor,
  SettingRow,
  SwitchRow,
  useScopedChannel,
} from './settings-parts.tsx';

// Settings: a searchable nav of grouped sections beside one section at a time (@omni/shared/settings-catalog.ts),
// the same sections in the same order as the phone's Settings screen. A scoped section shows the channel picker: This
// machine is this machine's values, a channel shows what it sets and what it inherits. Each value says where it comes
// from (built-in default, .env, this machine, the channel, this device), with Reset beside one Omni saved. Config
// fields come from the shared contract (@omni/shared/settings.ts) and save to data/omni.config.json through PUT
// /api/setup: as you change them, except a form with a URL, which saves with Save changes so a half-typed address
// never reaches the server.

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
      return <ModelsSection hermes={<ConfigSection part="models" />} />;
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
          <SyncKeysCard />
          <RefusedChangesCard />
          <PathMapEditor />
        </>
      );
    case 'access':
      return <AccessSection />;
    case 'secrets':
      return (
        <div id={settingAnchor('secrets')} className="scroll-mt-6 space-y-5">
          <SecretsSection />
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
    <ConfigSection part="general">
      <Card
        entry="setup"
        title="Setup"
        subtitle="Walk through the onboarding screens again, including the harness check."
        actions={
          <Button size="sm" onClick={openSetup}>
            Run setup again
          </Button>
        }
      />
    </ConfigSection>
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
      {part !== 'access' && part !== 'models' && <ConfigNote path={state?.path} />}
    </>
  );
}

function WorkspaceSection() {
  return <ConfigSection part="workspace" />;
}

function WorktreesSection() {
  return (
    <>
      <StorageSection />
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
        <ServerOptions section="threads" />
      </div>
      <div id={settingAnchor('automations')} className="scroll-mt-6">
        <LinkLine href={href.automations()}>Automations have their own page</LinkLine>
      </div>
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
          <Card title="Actions">
            <ChannelActionsEditor channelId={channel.id} />
          </Card>
        </div>
      </>
    );
  const listed = channels.filter((c) => !c.archived);
  const archived = channels.filter((c) => c.archived);
  return (
    <Card
      entry="channel-list"
      title="Your channels"
      subtitle="Pick one to see and change its settings. It stays picked as you move between sections."
      actions={
        <LinkButton size="sm" href={href.newChannel()} icon="plus">
          New channel
        </LinkButton>
      }
    >
      <ul className="divide-y divide-line">
        {listed.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setSettingsScope(c.id)} className="flex w-full min-w-0 items-center gap-3 py-2.5 text-left">
              <Avatar name={c.name} channelIcon={c.icon} avatarBg={c.avatar_bg} omni={c.id === 'conductor'} size={28} />
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
      <GoogleAccountSection />
      <ConnectSection />
      <IosPairingSection />
      <McpClientsCard />
      <InstallTokenCard />
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
  const mono = 'min-w-0 truncate font-mono text-[12.5px]';
  return (
    <>
      <Card entry="version" title="Version and build">
        <InfoList>
          <InfoRow label="Version">
            <span className="font-num">{s?.version ?? '…'}</span>
          </InfoRow>
          <InfoRow label="Commit">
            <span className={mono}>{s?.gitHead?.slice(0, 12) ?? 'Unknown'}</span>
          </InfoRow>
          {s?.startedAt && (
            <InfoRow label="Started">
              <span>{relTime(s.startedAt)}</span>
            </InfoRow>
          )}
        </InfoList>
      </Card>
      <LinkLine href={href.settingsSection('machines', 'update-machines')}>Updates are in Machines</LinkLine>
      <Card entry="server" title="Server">
        <InfoList>
          <InfoRow label="Address">
            <span className={mono}>{location.origin}</span>
          </InfoRow>
          {desktop ? (
            <AppServerRows bridge={desktop} />
          ) : (
            s?.port && (
              <InfoRow label="Port">
                <span className="font-num">{s.port}</span>
              </InfoRow>
            )
          )}
        </InfoList>
      </Card>
      <Card entry="files" title="Where Omni keeps its files" subtitle="All on this machine. None of it goes into git.">
        <InfoList>
          <InfoRow label="Repo">
            <span className={mono}>{s?.root ?? '…'}</span>
          </InfoRow>
          {!desktop && (
            <InfoRow label="Data">
              <span className={mono}>{s?.dataDir ?? '…'}</span>
            </InfoRow>
          )}
          <InfoRow label="Config">
            <span className={mono}>{setup.data?.path ?? 'data/omni.config.json'}</span>
          </InfoRow>
          <InfoRow label="Secrets">
            <span className="min-w-0 truncate">{store}</span>
          </InfoRow>
        </InfoList>
      </Card>
      <ServerOptions section="machines" />
    </>
  );
}

function ConfigNote({ path }: { path?: string }) {
  return (
    <FootNote>
      These settings live in <code>{path ?? 'data/omni.config.json'}</code> on this machine and never go into git. A value set in <code>.env</code> wins over one here,
      and the field then says so.
    </FootNote>
  );
}

/** Where a config field's value comes from now. */
function fieldOrigin(f: SettingField, state: SetupState): { of: Provenance; env?: string } {
  const env = state.env?.[settingId(f)];
  if (env) return { of: 'env', env };
  const saved = (state.config[f.section] as Record<string, string | undefined>)[f.key] ?? '';
  return saved && saved !== f.default ? { of: 'machine' } : { of: 'default' };
}

/** What a field .env sets resolves to, where the server says. */
const RESOLVED: Partial<Record<string, keyof SetupState['resolved']>> = {
  'user.timezone': 'timezone',
  'workspace.root': 'workspaceRoot',
  'integrations.hermesUrl': 'hermesUrl',
  'integrations.centralBrainDir': 'centralBrainDir',
};

/**
 * Typed fields wait for Save changes on a page with a URL, so a half-typed address never reaches the server. Every
 * other page saves a field as it changes: a text field on Return or leaving it, a picker on pick.
 */
const savesAsYouGo = (fields: readonly SettingField[]) => fields.every((f) => f.input !== 'url');

/**
 * One section's config fields, drawn from the shared settings contract (@omni/shared/settings.ts), so a new field
 * there shows here with no change to this file. A field .env sets, or one only the file sets, shows its value
 * read-only with where to change it. Reset beside a field saves its default at once and keeps the other drafts.
 */
function ConfigForm({ part, state, onSaved }: { part: SettingPage; state: SetupState; onSaved: (s: SetupState) => void }) {
  const { reloadProfile } = useApp();
  const fields = useMemo(() => pageFields(part), [part]);
  const editable = fields.filter((f) => !f.readonly && !state.env?.[settingId(f)]);
  const auto = savesAsYouGo(editable);
  const page = SETTING_PAGES[part];
  const [values, setValues] = useState(() => formValues(fields, state.config));
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Another window, a reset or `npm run setup` can change the file while this page is open. A field still as it was
  // saved follows the file; one being edited keeps its draft.
  const base = useRef(values);
  useEffect(() => {
    const next = formValues(fields, state.config);
    setValues((cur) => Object.fromEntries(Object.keys(next).map((k) => [k, cur[k] === base.current[k] ? next[k] : cur[k]])));
    base.current = next;
  }, [fields, state.config]);

  const patch = formPatch(editable, values);
  const dirty = JSON.stringify(patch) !== JSON.stringify(formPatch(editable, formValues(editable, state.config)));

  /** `key`: the field whose Reset spins, or 'form'. */
  const put = async (key: string, body: UserConfigPatch) => {
    setSaving(key);
    setError(null);
    setSaved(false);
    try {
      onSaved(await api.put<SetupState>('/setup', body));
      if (part === 'general') await reloadProfile();
      setSaved(true);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setSaving(null);
    }
  };

  /** Saves one field as it stands, unless it is unchanged or refused. */
  const commit = (f: SettingField, raw = values[settingId(f)] ?? '') => {
    if (!auto) return;
    const problem = settingProblem(f, raw, 'form');
    if (problem) return setError(problem);
    const next = raw.trim() || f.default;
    const now = (state.config[f.section] as Record<string, string | undefined>)[f.key] || f.default;
    if (next === now) return setError(null);
    void put(settingId(f), { [f.section]: { [f.key]: next } });
  };

  const saveAll = async (e: FormEvent) => {
    e.preventDefault();
    if (auto) return;
    const problem = editable.map((f) => settingProblem(f, values[settingId(f)] ?? '', 'form')).find(Boolean);
    if (problem) return setError(problem);
    await put('form', patch);
  };

  const reset = async (f: SettingField) => {
    if (await put(settingId(f), { [f.section]: { [f.key]: f.default } })) setValues((cur) => ({ ...cur, [settingId(f)]: f.default }));
  };

  const field = (f: SettingField) => {
    const o = fieldOrigin(f, state);
    const id = settingId(f);
    const fixed = f.readonly || o.of === 'env';
    return (
      <ConfigField
        key={id}
        field={f}
        value={values[id] ?? ''}
        fixed={fixed ? { env: o.env, shown: o.env ? (RESOLVED[id] ? state.resolved[RESOLVED[id]] : null) : (values[id] ?? '') } : null}
        fallbacks={state.fallbacks}
        onChange={(v) => (setValues((cur) => ({ ...cur, [id]: v })), setSaved(false))}
        onCommit={(v) => commit(f, v)}
        origin={<Origin of={o.of} />}
        action={!fixed && !f.required && <ResetButton of={o.of} onReset={() => void reset(f)} busy={saving === id} />}
      />
    );
  };
  const rows = (list: readonly SettingField[]) => <div className="space-y-5">{list.map(field)}</div>;
  const advanced = fields.filter((f) => f.advanced);

  return (
    <form onSubmit={saveAll} className="space-y-5">
      <Card entry={FORM_ENTRY[part]} title={page.title} subtitle={page.note}>
        {part === 'workspace' && <span id={settingAnchor('brain')} className="block scroll-mt-6" />}
        {rows(fields.filter((f) => !f.advanced))}
        {error && <ErrorNote>{error}</ErrorNote>}
        {editable.length > 0 &&
          (auto ? (
            <AutosaveNote saving={saving !== null} saved={saved} />
          ) : (
            <div className="flex items-center justify-end gap-3">
              {saved && !dirty && <span className="text-[12.5px] text-fg-3">Saved</span>}
              <Button type="submit" variant="primary" size="sm" busy={saving === 'form'} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          ))}
      </Card>
      {advanced.length > 0 && (
        <Advanced summary={page.advanced?.summary}>
          {page.advanced?.note && <p className="text-[12.5px] text-fg-3">{page.advanced.note}</p>}
          {rows(advanced)}
        </Advanced>
      )}
    </form>
  );
}

/** The search entry each form answers to. */
const FORM_ENTRY: Record<SettingPage, string> = { general: 'you', workspace: 'folders', models: 'hermes', access: 'network' };

const formValues = (fields: readonly SettingField[], c: UserConfig): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [settingId(f), (c[f.section] as Record<string, string | undefined>)[f.key] ?? f.default]));

/** The fields as PUT /api/setup takes them: trimmed, an empty one with a default (pronouns) back to it. */
function formPatch(fields: readonly SettingField[], values: Record<string, string>): UserConfigPatch {
  const patch: Partial<Record<SettingField['section'], Record<string, string>>> = {};
  for (const f of fields) (patch[f.section] ??= {})[f.key] = (values[settingId(f)] ?? '').trim() || f.default;
  return patch;
}

const MONO = new Set<SettingField['input']>(['folder', 'url', 'owner']);

/**
 * One config field. `fixed`: .env or only the file sets it, so it shows the value read-only with where to change it.
 * `onCommit` saves a value as it stands: a text field on Return or blur, a picker on pick.
 */
function ConfigField({
  field: f,
  value,
  fixed,
  fallbacks,
  onChange,
  onCommit,
  origin,
  action,
}: {
  field: SettingField;
  value: string;
  /** `shown`: null where the server does not say what .env resolves to. */
  fixed: { env?: string; shown: string | null } | null;
  fallbacks: SetupState['fallbacks'];
  onChange: (v: string) => void;
  onCommit: (v?: string) => void;
  origin: ReactNode;
  action: ReactNode;
}) {
  const id = `set-${f.key}`;
  const hint = settingHint(f, fallbacks);
  const describedBy = hint ? rowHintId(id) : undefined;
  const pick = (v: string) => (onChange(v), onCommit(v));
  const input = fixed ? (
    <>
      {fixed.shown !== null && (
        <div id={id} aria-describedby={describedBy} className={`font-mono text-[13px] break-all ${fixed.shown ? 'text-fg' : 'text-fg-3'}`}>
          {fixed.shown || 'Not set'}
        </div>
      )}
      <EnvNote env={fixed.env} file={fixed.env ? undefined : f.key} />
    </>
  ) : f.input === 'pronouns' ? (
    <PronounsField id={id} value={value} onChange={onChange} onPick={pick} onCommit={onCommit} describedBy={describedBy} />
  ) : f.input === 'timezone' ? (
    <Picker
      id={id}
      describedBy={describedBy}
      label={f.label}
      size="field"
      searchable
      value={value}
      onChange={pick}
      options={timezoneOptions(value, fallbacks.timezone)}
    />
  ) : (
    <input
      id={id}
      aria-describedby={describedBy}
      className={`field h-10 w-full${MONO.has(f.input) ? ' font-mono !text-[13px]' : ''}`}
      type={f.input === 'email' ? 'email' : 'text'}
      value={value}
      maxLength={f.max}
      autoComplete={f.autoComplete}
      placeholder={settingPlaceholder(f, fallbacks)}
      spellCheck={MONO.has(f.input) ? false : undefined}
      autoCapitalize={f.input === 'owner' ? 'off' : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={commitOnEnter}
      onBlur={() => onCommit()}
    />
  );
  return (
    <Row label={f.label} htmlFor={id} hint={hint} origin={origin} action={action}>
      {input}
    </Row>
  );
}

/** Return saves a field that saves as you go; on a form with Save changes, Return submits it. */
const commitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter' && !e.currentTarget.form?.querySelector('[type=submit]')) e.currentTarget.blur();
};

const SERVER_TZ = '';

function timezoneOptions(value: string, server: string) {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (value && !zones.includes(value)) zones = [value, ...zones];
  return [
    { value: SERVER_TZ, label: server ? `Server's timezone (${server})` : "Server's timezone", avatar: false as const },
    ...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' '), avatar: false as const })),
  ];
}

const OTHER = 'other';

/** Pronouns: the common ones in a picker, or Other with a field of your own. */
function PronounsField({
  id,
  value,
  onChange,
  onPick,
  onCommit,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (v: string) => void;
  onCommit: () => void;
  describedBy?: string;
}) {
  const [other, setOther] = useState(!PRONOUNS.includes(value));
  return (
    <div className="flex gap-2">
      <Picker
        id={id}
        describedBy={describedBy}
        label="Pronouns"
        size="field"
        className="min-w-0 flex-1"
        value={other ? OTHER : value}
        onChange={(v) => {
          setOther(v === OTHER);
          if (v !== OTHER) onPick(v);
          else onChange('');
        }}
        options={[...PRONOUNS.map((p) => ({ value: p, label: p, avatar: false as const })), { value: OTHER, label: 'Other…', avatar: false as const }]}
      />
      {other && <input aria-label="Your pronouns" className="field h-10 min-w-0 flex-1" value={value} placeholder="xe/xem" onChange={(e) => onChange(e.target.value)} onKeyDown={commitOnEnter} onBlur={onCommit} />}
    </div>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  const layout = useLayout();
  const inboxKey = useInboxKeyOn();
  const railColor = useRailColor();
  const mobile = useIsMobile();
  const thisBrowser = <Origin of="device" label="This browser" />;
  return (
    <>
      <Card entry="theme" title="Look">
        <SettingRow
          label="Theme"
          origin={thisBrowser}
          hint="Follows your system, or stays light or dark."
          control={
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
          }
        />
        {!mobile && (
          <div id={settingAnchor('layout')} className="scroll-mt-6">
            <SwitchRow
              title="Channel rail"
              origin={
                <>
                  <Chip tone="outline">Beta</Chip>
                  {thisBrowser}
                </>
              }
              detail="Channels as a rail of discs, with the selected channel's threads beside it. Turn it off for the classic sidebar. The phone layout stays as it is."
              checked={layout === 'rail'}
              onChange={(on) => setLayout(on ? 'rail' : 'classic')}
            />
          </div>
        )}
        {!mobile && layout === 'rail' && (
          <SwitchRow
            title="Full color channel rail"
            origin={thisBrowser}
            detail="Channel discs keep their colors. Off, they rest in grayscale until you hover or select one."
            checked={railColor === 'full'}
            onChange={(on) => setRailColor(on ? 'full' : 'grey')}
          />
        )}
      </Card>
      <Card entry="inbox-key" title="Keyboard">
        <SwitchRow
          title="Press I for the Inbox"
          origin={thisBrowser}
          detail="Opens the Inbox from anywhere outside a text field, in every layout. Turn it off if you type I by accident."
          checked={inboxKey}
          onChange={setInboxKeyOn}
        />
      </Card>
      <Card entry="zoom" title="Text size">
        {desktop ? (
          <ZoomRow bridge={desktop} />
        ) : (
          <SettingRow label="Zoom" origin={thisBrowser} hint="Use the browser's zoom: Cmd + and Cmd -, or Ctrl + and Ctrl - on Windows and Linux. The desktop app has its own." />
        )}
      </Card>
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
  const thisBrowser = <Origin of="device" label="This browser" />;
  const channelRow = (c: (typeof listed)[number]) => (
    <li key={c.id} className="py-2.5">
      <SwitchRow
        title={c.id === 'conductor' ? 'Conductor' : `#${c.name}`}
        origin={inScope ? thisBrowser : undefined}
        checked={!prefs.muted.includes(c.id)}
        onChange={(on) => setChannelAlerts(c.id, on)}
        disabled={!prefs.enabled}
      />
    </li>
  );
  const muteNote = 'A channel turned off still lists its results in Needs you, without a notification.';

  return (
    <>
      <Card entry="notify" title="This browser">
        <SwitchRow
          title="Notify in this browser"
          origin={thisBrowser}
          detail="Alerts when a thread finishes or fails while you are in another tab or app. Nothing alerts for the thread you are looking at. Turning it on asks the browser the first time."
          checked={prefs.enabled}
          onChange={toggle}
          disabled={permission === 'unsupported'}
        />
        <SettingRow
          label="Browser permission"
          control={
            <>
              {permission === 'default' && prefs.enabled && (
                <Button size="sm" onClick={() => void toggle(true)}>
                  Ask the browser
                </Button>
              )}
              <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-fg-2">
                <StatusDot status={PERMISSION_GLYPH[permission]} size={7} />
                {PERMISSION_LABEL[permission]}
              </span>
            </>
          }
        />
        {prefs.enabled && permission === 'denied' && (
          <ErrorNote>The browser blocks notifications for Omni. Allow them in the site settings (the icon left of the address), then come back.</ErrorNote>
        )}
      </Card>
      {inScope ? (
        <Card entry="notify-channels" title={inScope.id === 'conductor' ? 'Conductor' : `#${inScope.name}`} subtitle={muteNote}>
          <ul className={prefs.enabled ? '' : 'pointer-events-none opacity-55'}>{channelRow(inScope)}</ul>
        </Card>
      ) : (
        // One switch per channel grows with the sidebar, so the list folds shut like Advanced (#405).
        <div id={settingAnchor('notify-channels')} className="scroll-mt-6">
          <Advanced title="Channels" summary={`${listed.filter((c) => !prefs.muted.includes(c.id)).length} of ${listed.length} notify`}>
            <div className={`space-y-2 ${prefs.enabled ? '' : 'pointer-events-none opacity-55'}`}>
              <p className="text-[12.5px] text-fg-3">{muteNote}</p>
              {listed.length === 0 && <p className="text-[12.5px] text-fg-3">No channels yet.</p>}
              <ul className="divide-y divide-line">{listed.map(channelRow)}</ul>
            </div>
          </Advanced>
        </div>
      )}
    </>
  );
}
