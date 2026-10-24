import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { api, errorText, useApi, type Automation, type Thread } from '../api.ts';
import { DeliveryHistory } from '../components/DeliveryHistory.tsx';
import { Button, Chip, CopyButton, Empty, ErrorNote, Icon, InlineConfirm, Loading, PageHeader, StatusDot, Toggle } from '../components/ui.tsx';
import { artifactChannels, describeArtifactSource, describeCron, describeEvent, describeWebhookSource, nextRunLabel, relTime, shortPath } from '../format.ts';
import { href, navigate } from '../router.ts';
import { useApp, useFeed } from '../store.tsx';

const RUN_TONE: Record<string, string> = {
  done: 'var(--done)',
  failed: 'var(--needs)',
  stopped: 'var(--fg-4)',
  running: 'var(--live)',
  queued: 'var(--fg-4)',
};

/** Recent runs as a row of bars, oldest left: a glance at reliability. */
function RunStrip({ runs }: { runs: Automation['runs'] }) {
  if (!runs.length) return null;
  const bars = [...runs].reverse();
  return (
    <span className="flex h-3.5 items-end gap-[3px]" role="img" aria-label={`${runs.filter((r) => r.status === 'done').length} of ${runs.length} recent runs finished`}>
      {bars.map((r, i) => (
        <i key={i} title={`${r.status ?? 'removed'} · ${relTime(r.created_at)}`} className={`block w-[5px] rounded-full ${r.status === 'running' ? 'pulse' : ''}`} style={{ height: r.status === 'done' ? '100%' : '70%', background: RUN_TONE[r.status ?? ''] ?? 'var(--line-strong)' }} />
      ))}
    </span>
  );
}

const TRIGGER_CHIP = 'inline-flex h-6 items-center gap-1.5 rounded-full bg-bg px-2.5 whitespace-nowrap';
const FILTER_CHIP = 'inline-flex min-h-6 max-w-full items-center rounded-[12px] px-2 py-0.5 font-mono text-[11px] leading-snug break-words text-fg-4 shadow-[inset_0_0_0_1px_var(--line)]';

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

/** Where GitHub posts, and the signing secret it is checked against. The value goes to this Mac's Keychain and never comes back. */
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
                <StatusDot status="done" size={7} /> Signing secret set on this Mac
              </span>
            ) : (
              <span className="flex items-center gap-2 text-[12.5px] text-warn">
                <Icon name="alert" size={13} /> No signing secret on this Mac
              </span>
            )}
            {webhook.secret_set ? (
              <span className="mt-0.5 block truncate text-[11.5px] text-fg-4" title={webhook.secret}>
                Keychain <span className="font-mono">{webhook.secret}</span>
              </span>
            ) : (
              <span className="mt-0.5 block text-[11.5px] text-fg-4">GitHub deliveries are refused until you set the same secret you gave the hook on GitHub.</span>
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
              autoComplete="off"
              aria-label="Signing secret"
              className="field min-w-0 flex-1 basis-48 font-mono !text-[13px]"
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

function AutomationCard({ a, onChanged }: { a: Automation; onChanged: () => void }) {
  const { channel } = useApp();
  const [enabled, setEnabled] = useState(a.enabled);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
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
      onChanged();
    } catch (e) {
      setEnabled(!v);
      setError(errorText(e));
    } finally {
      setToggling(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const t = await api.post<Thread>(`/automations/${encodeURIComponent(a.id)}/run`);
      navigate(`/t/${t.id}`);
    } catch (e) {
      setError(errorText(e));
      setRunning(false);
    }
  };

  const ch = channel(a.channel);
  const channelName = (id: string) => channel(id)?.name ?? id;

  return (
    <div className={`rounded-[24px] bg-surface transition-opacity ${a.error ? 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--bad)_35%,transparent)]' : ''}`}>
      {/* On a phone the details span under the actions too, so the chips are not squeezed into a narrow column. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 p-4 md:p-5">
        <span className={`row-span-2 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg transition-colors ${enabled && !a.error ? 'text-fg' : 'text-fg-4'}`}>
          <Icon name="zap" size={16} />
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="font-display text-[16px]">{a.name}</h2>
          {!enabled && !a.error && <Chip tone="outline">Paused</Chip>}
          {a.error && <Chip tone="needs">Invalid</Chip>}
        </div>
        <div className="flex shrink-0 items-center gap-2.5 md:row-span-2">
          <Button size="sm" icon="play" onClick={runNow} busy={running} disabled={!!a.error}>
            Run now
          </Button>
          <Toggle checked={enabled} onChange={toggle} disabled={toggling || !!a.error} label={enabled ? 'Pause automation' : 'Enable automation'} />
        </div>
        <div className="col-[2/4] min-w-0 md:col-[2/3]">
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
            <TriggerChips a={a} channelName={channelName} />
            <a href={href.channel(a.channel)} className="hov inline-flex h-6 items-center rounded-full bg-bg px-2.5 [--hov:var(--surface-2)]">
              #{ch?.name ?? a.channel}
            </a>
            {a.role && <span className="inline-flex h-6 items-center rounded-full bg-bg px-2.5">{a.role}</span>}
            {a.model && <span className="inline-flex h-6 items-center rounded-full bg-bg px-2.5 font-num text-[11px]">{a.model}</span>}
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
            <div className="mt-2.5 text-[12.5px] text-fg-3">{a.poll_error ? <span className="text-fg-2">{a.poll_error}</span> : <>Watching <span className="font-medium text-fg">{a.repo}</span>, one run per event</>}</div>
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
            {a.error}. Fix it in <span className="font-mono text-[12px]">{shortPath(a.file ?? `automations/${a.id}.yaml`)}</span>.
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
        <button type="button" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt} className="hov flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-fg-3 [--hov:var(--surface-2)] hover:text-fg">
          <Icon name="chevronRight" size={12} className={`transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${showPrompt ? 'rotate-90' : ''}`} /> Prompt
        </button>
        {showPrompt && <pre className="fade-in mx-2.5 mt-1 mb-2 rounded-2xl bg-bg px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg-2">{a.prompt || '(empty)'}</pre>}
      </div>

      {(a.on?.event === 'artifact_published' || a.on?.event === 'github_webhook' || a.deliveries.length > 0) && (
        <div className="px-4 pt-2 pb-2 md:px-5">
          <div className="mb-2 flex items-center gap-3">
            <span className="caption">Deliveries</span>
          </div>
          {a.deliveries.length === 0 ? (
            <div className="text-[12.5px] text-fg-4">{a.on?.event === 'github_webhook' ? 'No GitHub deliveries since it was turned on.' : 'No pages published since it was turned on.'}</div>
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
          <div className="text-[12.5px] text-fg-4">Never run.</div>
        ) : (
          <ul className="-mx-2">
            {a.runs.map((r, i) => {
              const inner = (
                <>
                  <StatusDot status={r.status ?? 'failed'} size={7} />
                  <span className="min-w-0 flex-1 truncate">{r.title ?? 'Thread removed'}</span>
                  {r.trigger !== 'cron' && <span className="shrink-0 font-num text-[10.5px] text-fg-4">{r.trigger}</span>}
                  <span className="w-24 shrink-0 text-right font-num text-[11px] text-fg-4">{relTime(r.created_at)}</span>
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

export function AutomationsPage() {
  const res = useApi<Automation[]>('/automations');
  const { reload } = res;
  // Keep run and delivery statuses fresh when an automation thread or delivery changes state (debounced, threads update often).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFeed((e) => {
    if (e.type !== 'reconnect' && e.type !== 'automation_delivery' && !(e.type === 'thread' && e.thread.automation)) return;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      reload();
    }, 1000);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-3xl"
        title="Automations"
        subtitle={
          <>
            Scheduled or event-triggered prompts. Each run becomes a thread in its channel. Definitions live in <span className="font-mono text-[12px]">automations/*.yaml</span> and reload on save.
          </>
        }
        actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} busy={res.loading && !!res.data} aria-label="Refresh" />}
      />
      <div className="rise mx-auto max-w-3xl space-y-3 px-4 pt-2 pb-16 md:px-8">
        {res.error ? (
          <ErrorNote onRetry={reload}>{res.error}</ErrorNote>
        ) : !res.data ? (
          <Loading />
        ) : res.data.length === 0 ? (
          <Empty icon="clock" title="No automations yet">
            Add a YAML file to <span className="font-mono text-[12px]">automations/</span> with name, cron, channel and prompt. It shows up here right away.
          </Empty>
        ) : (
          res.data.map((a, i) => (
            <div key={a.id} style={{ '--i': i } as CSSProperties}>
              <AutomationCard a={a} onChanged={reload} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
