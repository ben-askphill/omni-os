import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, errorText, useApi, type Automation, type Thread } from '../api.ts';
import { Button, Chip, Empty, ErrorNote, Icon, Loading, PageHeader, StatusDot, Toggle } from '../components/ui.tsx';
import { describeCron, nextRunLabel, relTime, shortPath } from '../format.ts';
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

  return (
    <div className={`rounded-[24px] bg-surface transition-opacity ${a.error ? 'shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--bad)_35%,transparent)]' : ''}`}>
      <div className="flex items-start gap-3 p-4 md:p-5">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg transition-colors ${enabled && !a.error ? 'text-fg' : 'text-fg-4'}`}>
          <Icon name="zap" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="font-display text-[16px]">{a.name}</h2>
            {!enabled && !a.error && <Chip tone="outline">Paused</Chip>}
            {a.error && <Chip tone="needs">Invalid</Chip>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-bg px-2.5 whitespace-nowrap" title={`${a.cron} (${a.timezone})`}>
              <Icon name="clock" size={12} className="text-fg-3" />
              {describeCron(a.cron)}
            </span>
            <span className="inline-flex h-6 items-center rounded-full px-2 font-mono text-[11px] whitespace-nowrap text-fg-4 shadow-[inset_0_0_0_1px_var(--line)]">{a.cron}</span>
            <a href={href.channel(a.channel)} className="hov inline-flex h-6 items-center rounded-full bg-bg px-2.5 [--hov:var(--surface-2)]">
              #{ch?.name ?? a.channel}
            </a>
            {a.role && <span className="inline-flex h-6 items-center rounded-full bg-bg px-2.5">{a.role}</span>}
            {a.model && <span className="inline-flex h-6 items-center rounded-full bg-bg px-2.5 font-num text-[11px]">{a.model}</span>}
          </div>
          {enabled && a.next && !a.error && (
            <div className="mt-2.5 text-[12.5px] text-fg-3">
              Next run <span className="font-medium text-fg">{nextRunLabel(a.next, a.timezone)}</span>
              {a.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <span> ({a.timezone})</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button size="sm" icon="play" onClick={runNow} busy={running} disabled={!!a.error}>
            Run now
          </Button>
          <Toggle checked={enabled} onChange={toggle} disabled={toggling || !!a.error} label={enabled ? 'Pause automation' : 'Enable automation'} />
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

      <div className="px-2.5 pb-1">
        <button type="button" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt} className="hov flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-fg-3 [--hov:var(--surface-2)] hover:text-fg">
          <Icon name="chevronRight" size={12} className={`transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${showPrompt ? 'rotate-90' : ''}`} /> Prompt
        </button>
        {showPrompt && <pre className="fade-in mx-2.5 mt-1 mb-2 rounded-2xl bg-bg px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg-2">{a.prompt || '(empty)'}</pre>}
      </div>

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
                  {r.trigger === 'manual' && <span className="shrink-0 font-num text-[10.5px] text-fg-4">manual</span>}
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
  // Keep run statuses fresh when an automation thread changes state (debounced, threads update often).
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFeed((e) => {
    if (e.type !== 'reconnect' && !(e.type === 'thread' && e.thread.automation)) return;
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
            Scheduled prompts. Each run becomes a thread in its channel. Definitions live in <span className="font-mono text-[12px]">automations/*.yaml</span> and reload on save.
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
