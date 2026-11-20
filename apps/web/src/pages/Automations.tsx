import type { Device } from '@omni/shared/handoff.ts';
import { runOnRows } from '@omni/shared/thread-machine.ts';
import { runOnOptions } from '../components/RunOnPicker.tsx';
import { posthog } from '../posthog.ts';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { api, errorText, useApi, type Automation, type Thread, type SyncStatus } from '../api.ts';
import { DeliveryHistory } from '../components/DeliveryHistory.tsx';
import { AutomationEditor, type EditorTarget } from '../components/AutomationEditor.tsx';
import { Button, Chip, ConfirmDialog, CopyButton, Empty, ErrorNote, Icon, InlineConfirm, Loading, PageHeader, Picker, Segmented, StatusDot, Toggle, type PickerOption } from '../components/ui.tsx';
import { pageColumn, PageToolbar, RefreshButton, SearchField } from '../components/ui/feedback.tsx';
import { CrewMark, isCrewRole } from '../components/brand.tsx';
import { statusLabel } from '../components/ui.tsx';
import { describeCron, spanWords } from '@omni/shared/cron.ts';
import { relTime } from '@omni/shared/format.ts';
import { shortPath } from '@omni/shared/short-path.ts';
import { artifactChannels, describeArtifactSource, describeEvent, describeWebhookSource, nextRunLabel } from '../format.ts';
import { href, navigate } from '../router.ts';
import { useApp, useFeed, useHereName } from '../store.tsx';

const RUN_TONE: Record<string, string> = {
  done: 'var(--done)',
  failed: 'var(--needs)',
  stopped: 'var(--fg-4)',
  running: 'var(--live)',
  queued: 'var(--fg-4)',
  skipped: 'var(--line-strong)',
};

/** Recent runs as a row of bars, oldest left: a glance at reliability. */
function RunStrip({ runs }: { runs: Automation['runs'] }) {
  if (!runs.length) return null;
  const bars = runs.toReversed();
  return (
    <span className="flex h-3.5 items-end gap-[3px]" role="img" aria-label={`${runs.filter((r) => r.status === 'done').length} of ${runs.length} recent runs finished`}>
      {bars.map((r, i) => (
        <i key={i} title={`${r.status ?? 'removed'} · ${relTime(r.created_at)}`} className={`block w-[5px] rounded-full ${r.status === 'running' ? 'pulse' : ''}`} style={{ height: r.status === 'done' ? '100%' : r.status === 'skipped' ? '35%' : '70%', background: RUN_TONE[r.status ?? ''] ?? 'var(--line-strong)' }} />
      ))}
    </span>
  );
}

/** A scheduled run skipped before it started (failed precheck, stale catch-up): no thread to open, so the reason shows under it. */
function SkippedRun({ run }: { run: Automation['runs'][number] }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 px-2 py-1.5 text-[12.5px] text-fg-3">
      <StatusDot status="idle" size={7} className="mt-[5px]" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate font-num">{relTime(run.created_at)}</span>
          {run.trigger !== 'cron' && run.trigger !== PAUSE_TRIGGER && <span className="shrink-0 font-num text-[length:var(--fs-meta)]">{run.trigger}</span>}
          <span className="shrink-0 text-right text-[length:var(--fs-12)]">{run.trigger === PAUSE_TRIGGER ? 'Turned off' : 'Skipped'}</span>
        </span>
        <span className="mt-0.5 block font-mono text-[11px] leading-snug break-words">{run.skip_reason}</span>
      </span>
    </li>
  );
}

/** The history row Omni adds when it turns an automation off after 3 failed runs in a row (apps/server/automation-pause.ts). */
const PAUSE_TRIGGER = 'pause';

const TRIGGER_CHIP = 'inline-flex h-6 items-center gap-1.5 rounded-full bg-bg px-2.5 whitespace-nowrap';
const FILTER_CHIP = 'inline-flex min-h-6 max-w-full items-center rounded-[12px] px-2 py-0.5 font-mono text-[11px] leading-snug break-words text-fg-3 shadow-[inset_0_0_0_1px_var(--line)]';

/** What starts the automation: its event or schedule, then what it narrows to. */
function TriggerChips({ a, channelName }: { a: Automation; channelName: (id: string) => string }) {
  const on = a.on;
  if (on?.event === 'artifact_published') {
    return (
      <>
        <span className={TRIGGER_CHIP} title={`on: ${on.event}${on.updates ? ' (updates too)' : ''}`}>
          <Icon name="globe" size={12} className="text-fg-3" />
          {describeEvent(on.event)}
        </span>
        <span className={FILTER_CHIP}>{describeArtifactSource(on, channelName)}</span>
      </>
    );
  }
  if (on?.event === 'github_webhook') {
    return (
      <>
        <span className={TRIGGER_CHIP} title={`on: ${on.event}`}>
          <Icon name="branch" size={12} className="text-fg-3" />
          {describeEvent(on.event)}
        </span>
        <span className={FILTER_CHIP}>{describeWebhookSource(on)}</span>
      </>
    );
  }
  if (on) {
    return (
      <>
        <span className={TRIGGER_CHIP} title={`on: ${on.event}${on.drafts ? ' (drafts too)' : ''}`}>
          <Icon name="pr" size={12} className="text-fg-3" />
          {describeEvent(on.event)}
        </span>
        <span className={FILTER_CHIP}>{a.repo ?? 'no repo'}</span>
      </>
    );
  }
  return (
    <>
      <span className={TRIGGER_CHIP} title={`${a.cron} (${a.timezone})`}>
        <Icon name="clock" size={12} className="text-fg-3" />
        {describeCron(a.cron)}
      </span>
      <span className={FILTER_CHIP}>{a.cron}</span>
    </>
  );
}

/** Where GitHub posts, and the signing secret it is checked against. The value goes to the server's secret store and never comes back. */
function WebhookPanel({ id, webhook, onChanged }: { id: string; webhook: NonNullable<Automation['webhook']>; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/automations/${encodeURIComponent(id)}/webhook-secret`;

  const close = () => {
    setEditing(false);
    setValue('');
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(url, { value });
      close();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await api.del(url);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="px-4 pt-1 pb-2 md:px-5">
      <div className="mb-2 caption">Webhook</div>
      <div className="space-y-2.5 rounded-2xl bg-bg px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0 flex-1 font-mono text-[12px] break-all text-fg">{webhook.path}</span>
          <CopyButton text={webhook.path} className="shrink-0" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-2.5">
          <span className="min-w-0 flex-1 basis-56">
            {webhook.secret_set ? (
              <span className="flex items-center gap-2 text-[12.5px] text-fg-2">
                <StatusDot status="done" size={7} /> Signing secret set on this machine
              </span>
            ) : (
              <span className="flex items-center gap-2 text-[12.5px] text-warn">
                <Icon name="alert" size={13} /> No signing secret on this machine
              </span>
            )}
            {webhook.secret_set ? (
              <span className="mt-0.5 block truncate text-[11.5px] text-fg-3" title={webhook.secret}>
                Secret <span className="font-mono">{webhook.secret}</span>
              </span>
            ) : (
              <span className="mt-0.5 block text-[11.5px] text-fg-3">GitHub deliveries are refused until you set the same secret you gave the hook on GitHub.</span>
            )}
          </span>
          {!editing && (
            <span className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="secondary" icon="key" onClick={() => setEditing(true)}>
                {webhook.secret_set ? 'Replace secret…' : 'Set secret…'}
              </Button>
              {webhook.secret_set && <InlineConfirm label="Remove" icon="trash" confirmLabel="Remove" busyLabel="Removing" undoMs={5000} onConfirm={remove} />}
            </span>
          )}
        </div>
        {editing && (
          <form onSubmit={save} className="fade-in flex flex-wrap items-center gap-2">
            <input
              type="password"
              // A value to store, not a login: browsers ignore autocomplete="off" on a password field (Secrets.tsx).
              autoComplete="new-password"
              aria-label="Signing secret"
              className="field field-mono min-w-0 flex-1 basis-48"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste the secret from GitHub"
              spellCheck={false}
              autoFocus
              data-1p-ignore
              data-lpignore="true"
            />
            <span className="flex shrink-0 items-center gap-2">
              <Button type="submit" size="sm" variant="primary" busy={saving} disabled={!value.trim()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={close} disabled={saving}>
                Cancel
              </Button>
            </span>
          </form>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </div>
  );
}

/** Which machine runs it: its own `machine:`, else the shared pick. Null with one machine and nothing picked. */
function machineChip(a: Automation, devices: Device[] | null | undefined, hereName: string | undefined): { label: string; title: string; missing: boolean } | null {
  if (!a.machine && !devices?.length) return null;
  const own = a.machine ? 'Its own pick' : 'Follows Run automations on';
  if (a.runs_on.isThisMac) return { label: hereName ?? 'This machine', title: `${own}: runs on the machine you talk to`, missing: false };
  const d = devices?.find((x) => x.id === a.runs_on.owner);
  if (d) return { label: d.name, title: `${own}: runs on ${d.name}`, missing: false };
  return { label: a.machine ?? 'Unknown machine', title: 'No synced machine has this name, so it runs nowhere until one does', missing: true };
}

function AutomationCard({ a, devices, onChanged, onDelete, onEdit }: { a: Automation; devices: Device[] | null | undefined; onChanged: () => void; onDelete: () => void; onEdit: () => void }) {
  const { channel } = useApp();
  const hereName = useHereName();
  const machine = machineChip(a, devices, hereName);
  const [enabled, setEnabled] = useState(a.enabled);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState<'run' | 'dry' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  // Keep the optimistic value in sync when the list reloads.
  const [seen, setSeen] = useState(a.enabled);
  if (seen !== a.enabled) {
    setSeen(a.enabled);
    setEnabled(a.enabled);
  }

  const toggle = async (v: boolean) => {
    setEnabled(v);
    setToggling(true);
    setError(null);
    try {
      await api.post(`/automations/${encodeURIComponent(a.id)}/enabled`, { enabled: v });
      posthog.capture('automation_toggled', { enabled: v });
      onChanged();
    } catch (e) {
      setEnabled(!v);
      setError(errorText(e));
    } finally {
      setToggling(false);
    }
  };

  // A dry run says what it would do and does none of it (apps/server/automation-rules.ts).
  const runNow = async (dry = false) => {
    setRunning(dry ? 'dry' : 'run');
    setError(null);
    try {
      const t = await api.post<Thread>(`/automations/${encodeURIComponent(a.id)}/run`, dry ? { dry: true } : undefined);
      posthog.capture('automation_run_requested', { dry_run: dry });
      navigate(`/t/${t.id}`);
    } catch (e) {
      setError(errorText(e));
      setRunning(null);
    }
  };

  const ch = channel(a.channel);
  const channelName = (id: string) => channel(id)?.name ?? id;

  return (
    <div className={`rounded-[var(--r-xl)] bg-surface transition-opacity ${a.error ? 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--bad)_35%,transparent)]' : ''}`}>
      {/* On a phone the details span under the actions too, so the chips are not squeezed into a narrow column. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 p-4 md:p-5">
        <span className={`row-span-2 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg transition-colors ${enabled && !a.error ? 'text-fg' : 'text-fg-3'}`}>
          <Icon name="zap" size={16} />
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="font-display text-[length:var(--fs-heading)]">{a.name}</h2>
          {!enabled && !a.error && (a.runs[0]?.trigger === PAUSE_TRIGGER ? <Chip tone="needs" title={a.runs[0].skip_reason ?? undefined}>Turned off after 3 failed runs</Chip> : <Chip tone="outline">Paused</Chip>)}
          {a.error && <Chip tone="needs">Invalid</Chip>}
        </div>
        <div className="flex shrink-0 items-center gap-2.5 md:row-span-2">
          <Button size="sm" icon="play" onClick={() => void runNow()} busy={running === 'run'} disabled={!!a.error || !!running}>
            Run now
          </Button>
          <Toggle checked={enabled} onChange={toggle} disabled={toggling || !!a.error} label={enabled ? 'Pause automation' : 'Enable automation'} />
        </div>
        <div className="col-[2/4] min-w-0 md:col-[2/3]">
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
            <TriggerChips a={a} channelName={channelName} />
            <a href={href.channel(a.channel)} className="hov inline-flex h-6 items-center gap-1.5 rounded-full bg-bg px-2.5 [--hov:var(--surface-2)]" title={`Runs in #${ch?.name ?? a.channel}`}>
              <Icon name="hash" size={12} className="text-fg-3" />
              {ch?.name ?? a.channel}
            </a>
            {a.role && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-bg px-2.5" title={`Runs as ${a.role}`}>
                {isCrewRole(a.role) ? <CrewMark role={a.role} size={12} /> : <Icon name="layers" size={12} className="text-fg-3" />}
                {a.role}
              </span>
            )}
            {machine && (
              <span className={`inline-flex h-6 items-center gap-1.5 rounded-full bg-bg px-2.5 ${machine.missing ? 'text-warn' : ''}`} title={machine.title}>
                <Icon name={machine.missing ? 'alert' : 'monitor'} size={12} className={machine.missing ? '' : 'text-fg-3'} />
                {machine.label}
              </span>
            )}
            {a.model && <span className="inline-flex h-6 items-center rounded-full bg-bg px-2.5 font-num text-[11px]">{a.model}</span>}
            {a.quiet && (
              <Chip tone="outline" title="A run with nothing to report posts nothing and is filed as done">
                Quiet when empty
              </Chip>
            )}
            {a.approve && (
              <Chip tone="outline" title="Drafts first and asks on a card before anything leaves Omni">
                {a.expiresAfter ? `Asks first · expires in ${spanWords(a.expiresAfter)}` : 'Asks first'}
              </Chip>
            )}
            {a.source === 'edited' && <Chip tone="outline" title="Your copy of a shipped automation, in data/automations/">Edited</Chip>}
          </div>
          {enabled && a.on?.event === 'artifact_published' && !a.error && (
            <div className="mt-2.5 text-[12.5px] text-fg-3">
              {a.on.channels ? (
                <>
                  Runs once per page published in <span className="font-medium text-fg">{artifactChannels(a.on, channelName)}</span>
                </>
              ) : (
                'Runs once per published page'
              )}
            </div>
          )}
          {enabled && a.on?.event === 'github_webhook' && !a.error && (
            <div className="mt-2.5 text-[12.5px] text-fg-3">
              Runs once per GitHub delivery from <span className="font-medium text-fg">{a.on.repo}</span>
            </div>
          )}
          {enabled && a.on && a.on.event !== 'artifact_published' && a.on.event !== 'github_webhook' && !a.error && (
            <div className="mt-2.5 text-[12.5px] text-fg-3">
              {!a.runs_on.isThisMac ? (
                <>
                  Watches <span className="font-medium text-fg">{a.repo}</span> from {machine?.missing ? 'the machine it names, once that one syncs' : (machine?.label ?? 'the machine that runs it')}
                </>
              ) : a.poll_error ? (
                <span className="text-fg-2">{a.poll_error}</span>
              ) : (
                <>
                  Watching <span className="font-medium text-fg">{a.repo}</span>, one run per event
                </>
              )}
            </div>
          )}
          {enabled && a.next && !a.error && (
            <div className="mt-2.5 text-[12.5px] text-fg-3">
              Next run <span className="font-medium text-fg">{nextRunLabel(a.next, a.timezone)}</span>
              {a.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <span> ({a.timezone})</span>}
            </div>
          )}
        </div>
      </div>

      {a.error && (
        <div className="mx-4 mb-4 md:mx-5">
          <ErrorNote>
            {a.error}. Fix it with Edit, or in <span className="font-mono text-[12px]">{shortPath(a.file ?? `automations/${a.id}.yaml`)}</span>.
          </ErrorNote>
        </div>
      )}
      {error && (
        <div className="mx-4 mb-4 md:mx-5">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {a.webhook && !a.error && <WebhookPanel id={a.id} webhook={a.webhook} onChanged={onChanged} />}

      <div className="px-2.5 pb-1">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt} className="hov flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-fg-3 [--hov:var(--surface-2)] hover:text-fg">
            <Icon name="chevronRight" size={12} className={`transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${showPrompt ? 'rotate-90' : ''}`} /> Prompt
          </button>
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon="search"
              className="[--hov:var(--surface-2)]"
              onClick={() => void runNow(true)}
              busy={running === 'dry'}
              disabled={!!a.error || !!running}
              title="Runs it now and says what it would do, without sending or changing anything"
              aria-label={`Dry run ${a.name}`}
            >
              Dry run
            </Button>
            <Button size="sm" variant="ghost" icon="pencil" className="[--hov:var(--surface-2)]" onClick={onEdit} aria-label={`Edit ${a.name}`}>
              Edit
            </Button>
            <Button size="sm" variant="danger" icon="trash" className="[--hov:var(--surface-2)]" onClick={onDelete} aria-label={`Delete ${a.name}`}>
              Delete
            </Button>
          </span>
        </div>
        {showPrompt && <pre className="fade-in mx-2.5 mt-1 mb-2 rounded-2xl bg-bg px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg-2">{a.prompt || '(empty)'}</pre>}
      </div>

      {(a.on?.event === 'artifact_published' || a.on?.event === 'github_webhook' || a.deliveries.length > 0) && (
        <div className="px-4 pt-2 pb-2 md:px-5">
          <div className="mb-2 flex items-center gap-3">
            <span className="caption">Deliveries</span>
          </div>
          {a.deliveries.length === 0 ? (
            <div className="text-[12.5px] text-fg-3">{a.on?.event === 'github_webhook' ? 'No GitHub deliveries since it was turned on.' : 'No pages published since it was turned on.'}</div>
          ) : (
            <DeliveryHistory automation={a.id} latest={a.deliveries} latestMore={a.deliveries_more} onChanged={onChanged} />
          )}
        </div>
      )}

      <div className="px-4 pt-2 pb-4 md:px-5">
        <div className="mb-2 flex items-center gap-3">
          <span className="caption">Last runs</span>
          <RunStrip runs={a.runs} />
        </div>
        {a.runs.length === 0 ? (
          <div className="text-[12.5px] text-fg-3">Never run.</div>
        ) : (
          <ul className="-mx-2">
            {a.runs.map((r, i) => {
              if (r.skip_reason) return <SkippedRun key={`skip-${r.created_at}-${i}`} run={r} />;
              const inner = (
                <>
                  <StatusDot status={r.status ?? 'failed'} size={7} />
                  <span className="min-w-0 flex-1 truncate font-num" title={r.title ?? undefined}>
                    {relTime(r.created_at)}
                  </span>
                  {r.trigger !== 'cron' && <span className="shrink-0 font-num text-[length:var(--fs-meta)] text-fg-3">{r.trigger}</span>}
                  <span className="shrink-0 text-right text-[length:var(--fs-12)] text-fg-3">{r.thread_id ? statusLabel(r.status) : 'Thread removed'}</span>
                </>
              );
              return (
                <li key={`${r.thread_id ?? 'x'}-${i}`}>
                  {r.thread_id ? (
                    <a href={href.thread(r.thread_id)} className="hov flex h-8 min-w-0 items-center gap-2.5 rounded-full px-2 text-[12.5px] [--hov:var(--surface-2)]">
                      {inner}
                    </a>
                  ) : (
                    <div className="flex h-8 min-w-0 items-center gap-2.5 px-2 text-[12.5px] text-fg-3">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </div>
  );
}

/** Asks before deleting, naming the automation. Rendered by the page, outside the animated list, so its scrim covers the window. */
function DeleteAutomationDialog({ a, onClose, onDeleted }: { a: Automation | null; onClose: () => void; onDeleted: () => void }) {
  const { channel } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  const remove = async () => {
    if (!a) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/automations/${encodeURIComponent(a.id)}`);
      posthog.capture('automation_deleted');
      onDeleted();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={!!a} title={`Delete “${a?.name ?? ''}”?`} confirmLabel="Delete automation" danger busy={busy} error={error} onConfirm={() => void remove()} onCancel={close}>
      <p>
        <span className="font-medium text-fg">{a?.name}</span> stops running and leaves this list on this machine. Threads it already started stay in #
        {(a && channel(a.channel)?.name) ?? a?.channel}.
      </p>
      <p className="text-[12.5px] text-fg-3">You can’t undo this from Omni.</p>
    </ConfirmDialog>
  );
}

function AutomationMachine({ refreshing }: { refreshing: boolean }) {
  const status = useApi<SyncStatus>('/sync/status');
  const devices = useApi<Device[]>('/devices');
  const reloadStatus = status.reload;
  const reloadDevices = devices.reload;
  useEffect(() => {
    if (refreshing) { reloadStatus(); reloadDevices(); }
  }, [refreshing, reloadStatus, reloadDevices]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = status.data?.automations;
  const pick = owner?.isThisMac ? 'here' : owner?.owner ?? 'here';
  const options = runOnOptions(runOnRows(devices.data ?? [], { asDefault: true }));
  if (pick !== 'here' && !options.some((o) => o.value === pick)) {
    options.push({ value: pick, label: pick, sub: 'Machine unavailable', icon: 'monitor', avatar: false, disabled: true });
  }
  const save = async (device: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/sync/automations-owner', { device });
      status.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="relative z-10 rounded-[var(--r-xl)] bg-surface p-4 md:p-5">
      <div className="mb-2 text-[13px] font-medium">Run automations on</div>
      <Picker label="Run automations on" value={pick} options={options} onChange={(v) => void save(v)} disabled={saving || !status.data?.machineId || !devices.data} />
      <p className="mt-2 text-[12.5px] text-fg-3">Scheduled and event-triggered runs use the machine picked here after sync, unless an automation picks its own under Edit. It must be awake with Omni running. Run now uses the connected machine.</p>
      {status.data && !status.data.machineId && <p className="mt-2 text-[12.5px] text-fg-3">Sync another machine to choose where automations run.</p>}
      {(error || status.error || devices.error) && <ErrorNote className="mt-2">{error || status.error || devices.error}</ErrorNote>}
    </div>
  );
}

/**
 * Scan my usage (apps/server/usage-scan/): groups what Ben asks his agents for again and again, then starts a thread
 * that suggests up to three automations. Starting it can take a minute or two while Haiku labels the groups.
 */
function UsageScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { channels } = useApp();
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo<PickerOption<string>[]>(
    () => [
      { value: '', label: 'All channels', icon: 'layers', avatar: false },
      ...channels
        .filter((c) => !c.archived)
        .map((c) => ({ value: c.id, label: c.name, channelIcon: c.icon, avatarBg: c.avatar_bg, ...(c.scan_opt_out ? { disabled: true, sub: 'Left out of usage scans' } : {}) })),
    ],
    [channels],
  );
  const close = () => {
    setError(null);
    onClose();
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ thread: Thread }>('/usage-scan', scope ? { channel: scope } : {});
      posthog.capture('usage_scan_started', { scoped_to_channel: !!scope });
      close();
      navigate(`/t/${r.thread.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} title="Scan my usage" confirmLabel={busy ? 'Scanning' : 'Start scan'} busy={busy} error={error} onConfirm={() => void start()} onCancel={close}>
      <p>Omni reads the messages you typed to your agents in the last 90 days, groups what you ask for again and again, and starts a thread in #Inbox that suggests up to three automations.</p>
      <p className="text-[12.5px] text-fg-3">
        Secrets are masked first, and Haiku labels the groups on this machine. Nothing is saved until you pick suggestions in that thread, and what it saves starts off. Channels set to Leave out of usage scans are skipped.
      </p>
      <Picker size="field" label="Channels to scan" value={scope} onChange={setScope} options={options} searchable />
    </ConfirmDialog>
  );
}

const TRIGGER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'schedule', label: 'Scheduled' },
  { id: 'event', label: 'On an event' },
] as const;
type TriggerFilter = (typeof TRIGGER_FILTERS)[number]['id'];

const matchesTrigger = (f: TriggerFilter, a: Automation) => f === 'all' || (f === 'event') === !!a.on;

const matchesSearch = (a: Automation, q: string) => {
  const t = q.trim().toLowerCase();
  return !t || a.name.toLowerCase().includes(t) || a.id.toLowerCase().includes(t) || (a.prompt ?? '').toLowerCase().includes(t);
};

export function AutomationsPage() {
  const res = useApi<Automation[]>('/automations');
  const devices = useApi<Device[]>('/devices');
  const reloadList = res.reload;
  const reloadDevices = devices.reload;
  // The machine chips name devices: a machine that synced since the page opened shows by name.
  const reload = useCallback(() => {
    reloadList();
    reloadDevices();
  }, [reloadList, reloadDevices]);
  const [deleting, setDeleting] = useState<Automation | null>(null);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [scanning, setScanning] = useState(false);
  // Keep run and delivery statuses fresh when an automation thread or delivery changes state (debounced, threads update often).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFeed((e) => {
    if (e.type !== 'reconnect' && e.type !== 'automation_delivery' && e.type !== 'automations' && !(e.type === 'thread' && e.thread.automation)) return;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      reload();
    }, 1000);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const [q, setQ] = useState('');
  const [trigger, setTrigger] = useState<TriggerFilter>('all');
  const all = res.data ?? [];
  const found = useMemo(() => all.filter((a) => matchesSearch(a, q)), [all, q]);
  const list = found.filter((a) => matchesTrigger(trigger, a));
  const counts = Object.fromEntries(TRIGGER_FILTERS.map((f) => [f.id, found.filter((a) => matchesTrigger(f.id, a)).length])) as Record<TriggerFilter, number>;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        width="page"
        title="Automations"
        subtitle={
          <>
            Prompts that run on a schedule or when something happens. Each run becomes a thread in its channel. Edits here write the YAML in <span className="font-mono text-[length:var(--fs-code)] text-fg-2">data/automations/</span>, and hand edits to it reload when you save.
          </>
        }
      />
      <div className={`${pageColumn('page')} rise space-y-3 pb-16`}>
        <PageToolbar
          className="mb-4"
          right={
            <span className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon="gauge" onClick={() => setScanning(true)}>
                Scan my usage
              </Button>
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing({ id: null })}>
                New
              </Button>
              <RefreshButton onClick={reload} busy={res.loading && !!res.data} label="Reload automations" />
            </span>
          }
        >
          <SearchField value={q} onChange={setQ} placeholder="Search automations" label="Search automations" />
          <Segmented
            label="Trigger"
            value={trigger}
            onChange={setTrigger}
            size="sm"
            options={TRIGGER_FILTERS.map((f) => ({
              id: f.id,
              label: f.label,
              badge: counts[f.id] ? <span className="font-num text-[10.5px] text-fg-3 tabular-nums">{counts[f.id]}</span> : undefined,
            }))}
          />
        </PageToolbar>
        <AutomationMachine refreshing={res.loading} />
        {res.error ? (
          <ErrorNote onRetry={reload}>{res.error}</ErrorNote>
        ) : !res.data ? (
          <Loading />
        ) : res.data.length === 0 ? (
          <Empty icon="clock" title="No automations yet">
            Make one with New, or add a YAML file to <span className="font-mono text-[12px]">data/automations/</span> with name, cron, channel and prompt. It shows up here right away.
          </Empty>
        ) : list.length === 0 ? (
          <Empty icon="search" title="No match">
            No automation matches this search and trigger.
          </Empty>
        ) : (
          list.map((a, i) => (
            <div key={a.id} style={{ '--i': i } as CSSProperties}>
              <AutomationCard a={a} devices={devices.data} onChanged={reload} onDelete={() => setDeleting(a)} onEdit={() => setEditing({ id: a.id, name: a.name })} />
            </div>
          ))
        )}
      </div>
      <DeleteAutomationDialog a={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />
      <AutomationEditor target={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <UsageScanDialog open={scanning} onClose={() => setScanning(false)} />
    </div>
  );
}
