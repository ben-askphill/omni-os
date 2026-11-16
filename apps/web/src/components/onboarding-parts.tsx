// The pieces the onboarding wizard (Onboarding.tsx) is built from: the screen frame, the form row, the step dots, the
// harness check, and the timezone and pronoun fields Settings reuses.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';
import { HARNESS_CHECK_LABEL, harnessCheck } from '@omni/shared/harness-check.ts';
import { api, errorText, type HarnessWithRunning } from '../api.ts';
import { PERMISSION_LABEL, permissionNow, setNotificationsEnabled, useNotificationPrefs, type Permission } from '../attention.ts';
import { desktop } from '../desktop.ts';
import { Button, CopyButton, ErrorNote, Icon, Label, StatusDot, Toggle } from './ui.tsx';

export const PRONOUNS = ['they/them', 'she/her', 'he/him'];
export const STEPS = ['You', 'Workspace', 'Harnesses', 'Channel', 'Notifications', 'Done'] as const;

export async function createChannel(name: string, repo: string, store: string) {
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'project';
  const ch = await api.post<{ id: string }>('/channels', {
    id: id.length < 2 ? `${id}-1` : id,
    name: name.trim(),
    kind: 'client',
    repo_path: repo.trim() || null,
    use_worktree: repo.trim() ? 1 : 0,
    store_domain: store.trim() || null,
  });
  return ch.id;
}

/** What a harness is for, under its row, when that is more than "another place to run threads". */
const HARNESS_NOTE: Partial<Record<string, string>> = {
  codex: 'Reviews the pull requests Claude writes. Without it, the Conductor asks you what to do each time.',
};

export function HarnessScreen() {
  const [list, setList] = useState<HarnessWithRunning[] | null>(null);
  const [checking, setChecking] = useState(false);
  const load = async () => {
    setChecking(true);
    try {
      // Hermes and Cursor Cloud run off this Mac: listed once they work, never as something to install.
      setList((await api.get<HarnessWithRunning[]>('/harnesses')).filter((h) => (h.id !== 'hermes' && h.id !== 'cursor-cloud') || h.available));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    load().catch(() => setList([]));
  }, []);
  const claude = list?.find((h) => h.id === 'claude-code');
  const codex = list?.find((h) => h.id === 'codex');
  return (
    <Screen
      caption="Harnesses"
      title="The agents Omni can run"
      body="Each thread runs on a CLI you are signed in to, billed to that plan. Omni needs Claude Code. Codex reviews the pull requests Claude writes. Cursor Agent is optional."
    >
      <ul className="space-y-2">
        {(list ?? []).map((h) => {
          const check = harnessCheck(h);
          const ready = check.state === 'ready';
          const note = HARNESS_NOTE[h.id];
          return (
            <li key={h.id} className="rounded-[16px] bg-surface p-3.5" data-harness={h.id} data-state={check.state}>
              <div className="flex items-center gap-2.5">
                <span className={`grid h-6 w-6 place-items-center rounded-full ${ready ? 'bg-done text-on-done' : 'bg-bg text-fg-3'}`}>
                  <Icon name={ready ? 'check' : 'x'} size={13} />
                </span>
                <span className="text-[13.5px] font-medium">{h.name}</span>
                <span className="text-[12px] text-fg-3">{h.plan}</span>
                <span className={`ml-auto text-[12px] ${ready ? 'text-fg-2' : 'text-fg-3'}`}>{HARNESS_CHECK_LABEL[check.state]}</span>
              </div>
              {(note || !ready) && (
                <div className="mt-2.5 space-y-1.5 pl-[34px]">
                  {note && <p className="text-[12px] leading-relaxed text-fg-3">{note}</p>}
                  {check.install && <Command label="Install" cmd={check.install} />}
                  {check.command && <Command label="Sign in" cmd={check.command} />}
                  {check.reason && <p className="text-[12px] leading-relaxed text-fg-2">{check.reason}</p>}
                </div>
              )}
            </li>
          );
        })}
        {!list && <li className="py-6 text-center text-[13px] text-fg-3">Checking…</li>}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12px] text-fg-3">
          {claude && !claude.available
            ? 'Set up Claude Code before your first thread.'
            : codex && !codex.available
              ? 'Set up Codex for PR reviews, or the Conductor asks you each time.'
              : 'You can add the others any time.'}
        </span>
        <Button variant="ghost" busy={checking} onClick={() => void load()}>
          Check again
        </Button>
      </div>
    </Screen>
  );
}

const NOTIFY_BODY = 'Omni can tell you when an agent asks you something, a thread finishes or fails, or the crew reports back.';

/**
 * Asks about notifications now, not in the middle of work: in the desktop app a sample notification brings up the
 * OS's permission prompt (macOS asks at the first one); in a browser the switch asks the browser, as Settings does.
 */
export function NotificationsScreen({ bridge = desktop }: { bridge?: DesktopBridge | null }) {
  return bridge?.nativeNotifications ? <AppNotify bridge={bridge} /> : <BrowserNotify />;
}

const MORE = 'Pick which kinds notify, and which channels stay quiet, in Settings > Notifications.';

function NotifyRow({ title, detail, checked, onChange, disabled }: { title: string; detail: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-4 rounded-[16px] bg-surface p-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">{detail}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

const PERMISSION_GLYPH: Record<Permission, string> = { granted: 'done', denied: 'needs', default: 'settled', unsupported: 'settled' };

function BrowserNotify() {
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<Permission>(permissionNow);
  const toggle = async (on: boolean) => setPermission(await setNotificationsEnabled(on));
  return (
    <Screen caption="Notifications" title="Hear when work needs you" body={`${NOTIFY_BODY} In a browser they start off.`}>
      <NotifyRow
        title="Notify in this browser"
        detail="While an Omni tab is open. Turning it on asks the browser once."
        checked={prefs.enabled}
        onChange={(on) => void toggle(on)}
        disabled={permission === 'unsupported'}
      />
      <p className="flex items-center gap-1.5 text-[12.5px] text-fg-2" data-permission={permission}>
        <StatusDot status={PERMISSION_GLYPH[permission]} size={7} />
        {PERMISSION_LABEL[permission]}
      </p>
      {permission === 'unsupported' && (
        <p className="text-[12.5px] leading-relaxed text-fg-3">On an iPhone, the Omni app sends push alerts instead. Pair it from Settings {'>'} Sharing &amp; access.</p>
      )}
      {prefs.enabled && permission === 'denied' && <ErrorNote>The browser blocks notifications for Omni. Allow them in the site settings (the icon left of the address), then turn this on again.</ErrorNote>}
      <p className="text-[12px] text-fg-3">{MORE}</p>
    </Screen>
  );
}

function AppNotify({ bridge }: { bridge: DesktopBridge }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [sent, setSent] = useState<'sent' | 'unsupported' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    bridge.settings.get().then(
      (s) => setEnabled(s.notifications.enabled),
      (err) => setError(errorText(err)),
    );
  }, [bridge]);
  const where = bridge.platform === 'darwin' ? 'System Settings > Notifications > Omni' : 'your desktop’s notification settings';
  const save = async (on: boolean) => {
    setError(null);
    try {
      setEnabled((await bridge.settings.set({ notifications: { enabled: on } })).notifications.enabled);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent((await bridge.testNotification!()) ? 'sent' : 'unsupported');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      caption="Notifications"
      title="Hear when work needs you"
      body={`${NOTIFY_BODY} The app sends them even with every window closed.${bridge.platform === 'darwin' ? ' macOS asks once whether Omni may; send a test now so it asks here, not mid-task.' : ''}`}
    >
      <NotifyRow title="Notify from the desktop app" detail="Native notifications. Clicking one opens its thread." checked={enabled ?? true} onChange={(on) => void save(on)} disabled={enabled === null} />
      {bridge.testNotification && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void test()} busy={busy} disabled={enabled === false}>
            Send a test notification
          </Button>
          {sent && (
            <span className="text-[12.5px] text-fg-2" data-sent={sent}>
              {sent === 'sent' ? `Sent. If nothing showed, allow Omni in ${where}.` : 'This system cannot show notifications.'}
            </span>
          )}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-[12px] text-fg-3">{MORE}</p>
    </Screen>
  );
}

function Command({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-12 shrink-0 text-[11.5px] text-fg-3">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-[8px] bg-code px-2 py-1 font-mono text-[12px]">{cmd}</code>
      <CopyButton text={cmd} />
    </div>
  );
}

export function Steps({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((s, i) => (
        <li key={s} title={s} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-fg' : i < step ? 'w-1.5 bg-fg-2' : 'w-1.5 bg-fg-4'}`} />
      ))}
    </ol>
  );
}

export function Screen({ caption, title, body, children }: { caption: string; title: string; body: string; children: ReactNode }) {
  return (
    <div>
      <div className="caption mb-2">{caption}</div>
      <h2 id="onboarding-title" className="font-display text-[length:var(--fs-title)] leading-[1.15]">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-3">{body}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

export function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export function Summary({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-3">{k}</dt>
      <dd className={`min-w-0 truncate ${mono ? 'font-mono text-[12.5px]' : ''}`}>{v}</dd>
    </>
  );
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

export function TimezoneInput({ id, value, onChange, describedBy }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);
  return (
    <>
      <input id={id} aria-describedby={describedBy} className="field w-full" list={`${id}-zones`} value={value} placeholder="Europe/Amsterdam" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-zones`}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

export function PronounsInput({ id, value, onChange, describedBy }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const custom = !PRONOUNS.includes(value);
  const [other, setOther] = useState(custom);
  return (
    <div className="flex gap-2">
      <select
        id={id}
        aria-describedby={describedBy}
        className="field min-w-0 flex-1"
        value={other ? 'other' : value}
        onChange={(e) => {
          const v = e.target.value;
          setOther(v === 'other');
          if (v !== 'other') onChange(v);
          else onChange('');
        }}
      >
        {PRONOUNS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="other">Other…</option>
      </select>
      {other && <input aria-label="Your pronouns" className="field min-w-0 flex-1" value={value} placeholder="xe/xem" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
