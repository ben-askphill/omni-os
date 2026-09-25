import { useEffect, useRef, useState } from 'react';
import { api, errorText, useApi, type Automation, type Thread } from '../api.ts';
import { Button, Chip, Empty, ErrorNote, Icon, Loading, PageHeader, StatusDot, Toggle } from '../components/ui.tsx';
import { describeCron, nextRunLabel, relTime, shortPath } from '../format.ts';
import { href, navigate } from '../router.ts';
import { useApp, useFeed } from '../store.tsx';

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
    <div className={`rounded-xl border bg-surface ${a.error ? 'border-bad/40' : 'border-line'}`}>
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-[14.5px] font-semibold tracking-[-0.015em]">{a.name}</h2>
            {!enabled && !a.error && <Chip tone="outline">Paused</Chip>}
            {a.error && <Chip tone="bad">Invalid</Chip>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
            <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`${a.cron} (${a.timezone})`}>
              <Icon name="clock" size={13} />
              {describeCron(a.cron)}
            </span>
            <span className="font-mono text-[11.5px] whitespace-nowrap text-fg-4">{a.cron}</span>
            <a href={href.channel(a.channel)} className="hover:text-fg">
              #{ch?.name ?? a.channel}
            </a>
            {a.role && <span>role {a.role}</span>}
            {a.model && <span>{a.model}</span>}
          </div>
          {enabled && a.next && !a.error && (
            <div className="mt-1 text-[12.5px] text-fg-2">
              Next run <span className="font-medium">{nextRunLabel(a.next, a.timezone)}</span>
              {a.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <span className="text-fg-3"> ({a.timezone})</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" icon="play" onClick={runNow} busy={running} disabled={!!a.error}>
            Run now
          </Button>
          <Toggle checked={enabled} onChange={toggle} disabled={toggling || !!a.error} label={enabled ? 'Pause automation' : 'Enable automation'} />
        </div>
      </div>

      {a.error && (
        <div className="mx-4 mb-3">
          <ErrorNote>
            {a.error}. Fix it in <span className="font-mono text-[12px]">{shortPath(a.file ?? `automations/${a.id}.yaml`)}</span>.
          </ErrorNote>
        </div>
      )}
      {error && (
        <div className="mx-4 mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="border-t border-line px-4 py-2">
        <button type="button" onClick={() => setShowPrompt((v) => !v)} className="flex items-center gap-1 text-[12px] font-medium text-fg-3 hover:text-fg">
          <Icon name={showPrompt ? 'chevronDown' : 'chevronRight'} size={12} /> Prompt
        </button>
        {showPrompt && <pre className="mt-1.5 mb-1 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fg-2">{a.prompt || '(empty)'}</pre>}
      </div>

      <div className="border-t border-line px-4 py-2.5">
        <div className="mb-1 text-[12px] font-medium text-fg-3">Last runs</div>
        {a.runs.length === 0 ? (
          <div className="text-[12.5px] text-fg-4">Never run.</div>
        ) : (
          <ul className="space-y-px">
            {a.runs.map((r, i) => {
              const inner = (
                <>
                  <StatusDot status={r.status ?? 'failed'} size={7} />
                  <span className="min-w-0 flex-1 truncate">{r.title ?? 'Thread removed'}</span>
                  {r.trigger === 'manual' && <span className="shrink-0 text-[11px] text-fg-4">manual</span>}
                  <span className="w-24 shrink-0 text-right text-[11.5px] text-fg-3">{relTime(r.created_at)}</span>
                </>
              );
              return (
                <li key={`${r.thread_id ?? 'x'}-${i}`}>
                  {r.thread_id ? (
                    <a href={href.thread(r.thread_id)} className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-surface-2">
                      {inner}
                    </a>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2 py-1 text-[12.5px] text-fg-3">{inner}</div>
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
      <PageHeader
        title="Automations"
        subtitle={
          <>
            Scheduled prompts. Each run becomes a thread in its channel. Definitions live in <span className="font-mono text-[12px]">automations/*.yaml</span> and reload on save.
          </>
        }
        actions={<Button size="sm" variant="ghost" icon="refresh" onClick={reload} busy={res.loading && !!res.data} aria-label="Refresh" />}
      />
      <div className="mx-auto max-w-3xl space-y-3 px-4 pt-5 pb-16 md:px-8">
        {res.error ? (
          <ErrorNote onRetry={reload}>{res.error}</ErrorNote>
        ) : !res.data ? (
          <Loading />
        ) : res.data.length === 0 ? (
          <Empty icon="clock" title="No automations yet">
            Add a YAML file to <span className="font-mono text-[12px]">automations/</span> with name, cron, channel and prompt. It shows up here right away.
          </Empty>
        ) : (
          res.data.map((a) => <AutomationCard key={a.id} a={a} onChanged={reload} />)
        )}
      </div>
    </div>
  );
}
