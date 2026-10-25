import { useLayoutEffect, useRef, useState } from 'react';
import { portLabel, RUN_STATE_LABEL, SETUP_MODE_LABEL, type ActionRun, type ChannelAction } from '@omni/shared/channel-actions.ts';
import type { Thread } from '../../../api.ts';
import { liveRun, outputCut, RUN_GLYPH, runSummary, useThreadActions } from '../../../channel-actions.ts';
import { relTime } from '../../../format.ts';
import { href } from '../../../router.ts';
import { Button, Chip, Empty, ErrorNote, Icon, IconButton, Loading, StatusPill } from '../../ui.tsx';

const CARD = 'rounded-[18px] shadow-[inset_0_0_0_1px_var(--line)]';
const HEADING = 'flex items-center gap-2 px-1.5 pb-1.5 text-[11.5px] font-medium text-fg-3';

/**
 * The channel's named commands, run in this thread's checkout, and the thread's runs of them with their output. The
 * desktop panel and the phone's Actions screen both show it.
 */
export function ActionsTab({ thread }: { thread: Pick<Thread, 'id' | 'channel_id'> }) {
  // One instance per thread, so an answer that lands after a switch never mixes into another thread's runs.
  return <ThreadActionsView key={thread.id} threadId={thread.id} channelId={thread.channel_id} />;
}

function ThreadActionsView({ threadId, channelId }: { threadId: string; channelId: string }) {
  const { data, error, loading, reload, busy, errors, run, stop, retry } = useThreadActions(threadId);

  if (!data) {
    return <div className="px-3">{error ? <ErrorNote onRetry={reload}>{error}</ErrorNote> : <Loading label="Loading actions" />}</div>;
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto px-3 pb-3">
      {error && (
        <ErrorNote className="mb-2" onRetry={reload}>
          {error}
        </ErrorNote>
      )}
      {data.actions.length ? (
        <section aria-label="Actions">
          <div className={HEADING}>
            <span className="flex-1">Actions</span>
            <IconButton icon="refresh" label="Refresh actions" size={14} onClick={reload} className={`-my-1.5 ${loading ? 'opacity-50' : ''}`} />
          </div>
          {data.blocked && <p className="mb-2 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-snug text-fg-2">{data.blocked}</p>}
          <div className="space-y-1.5">
            {data.actions.map((a) => {
              const live = liveRun(data, a);
              return (
                <div key={a.id} className={`${CARD} px-3.5 py-2.5`}>
                  <div className="flex items-center gap-3">
                    <ActionLine action={a} />
                    {live ? (
                      <Button size="sm" icon="stop" busy={busy.has(live.id)} onClick={() => void stop(live)}>
                        Stop
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" icon="play" busy={busy.has(a.id)} disabled={!!data.blocked} onClick={() => void run(a)}>
                        Run
                      </Button>
                    )}
                  </div>
                  {errors[a.id] && <ErrorNote className="mt-2">{errors[a.id]}</ErrorNote>}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <Empty icon="play" title="No actions in this channel">
          Name the commands threads here can run, like a theme preview or the tests, in the{' '}
          <a className="underline underline-offset-2" href={href.settings(channelId)}>
            channel's settings
          </a>
          .
        </Empty>
      )}
      {data.runs.length > 0 && (
        <section aria-label="Runs" className="mt-5">
          <div className={HEADING}>
            <span>Runs</span>
            <span className="font-num text-fg-4">{data.runs.length}</span>
          </div>
          <div className="space-y-2">
            {data.runs.map((r, i) => (
              <RunRow
                key={r.id}
                run={r}
                latest={i === 0}
                setup={r.id === data.setup_run?.id}
                busy={busy.has(r.id)}
                error={errors[r.id]}
                blocked={!!data.blocked}
                onStop={() => void stop(r)}
                onRetry={() => void retry(r)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Name, command and port of an action, shared with the channel settings editor. */
export function ActionLine({ action }: { action: Pick<ChannelAction, 'name' | 'command' | 'port' | 'setup'> }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium text-fg">{action.name}</span>
        {action.setup && (
          <Chip tone="outline" title={`Runs in each new worktree, ${SETUP_MODE_LABEL[action.setup].toLowerCase()}`}>
            Setup
          </Chip>
        )}
      </div>
      <div className="truncate font-mono text-[11.5px] text-fg-3" title={action.command}>
        {action.command}
      </div>
      <div className="text-[11.5px] text-fg-4">{portLabel(action.port)}</div>
    </div>
  );
}

function RunRow({
  run,
  latest,
  setup,
  busy,
  error,
  blocked,
  onStop,
  onRetry,
}: {
  run: ActionRun;
  latest: boolean;
  setup: boolean;
  busy: boolean;
  error: string | undefined;
  blocked: boolean;
  onStop: () => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(latest);
  const running = run.state === 'running';
  return (
    <div className={CARD}>
      <div className="flex items-start gap-2 py-2 pr-2.5 pl-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="hov flex min-w-0 flex-1 items-start gap-1.5 rounded-[12px] px-1.5 py-1 text-left">
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="mt-[3px] shrink-0 text-fg-4" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[13px] font-medium text-fg">{run.name}</span>
              <StatusPill status={RUN_GLYPH[run.state]} label={RUN_STATE_LABEL[run.state]} />
              {setup && (
                <Chip tone="outline" title="The run that set up this thread's worktree">
                  Setup
                </Chip>
              )}
            </span>
            <span className="mt-0.5 block font-num text-[11.5px] text-fg-3">{[relTime(run.started_at), runSummary(run)].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
        {running ? (
          <Button size="sm" icon="stop" busy={busy} onClick={onStop} className="mt-0.5">
            Stop
          </Button>
        ) : (
          run.action_id && (
            <Button size="sm" icon="refresh" busy={busy} disabled={blocked} onClick={onRetry} className="mt-0.5">
              Retry
            </Button>
          )
        )}
      </div>
      {run.error && <p className="px-3.5 pb-2 text-[12px] leading-snug text-fg-2">{run.error}</p>}
      {error && <ErrorNote className="mx-2 mb-2">{error}</ErrorNote>}
      {open && <RunOutput run={run} />}
    </div>
  );
}

/** Stays on the newest line while it runs, unless Ben scrolled up to read. The setup card shows it shorter. */
export function RunOutput({ run, className = 'px-2 pb-2', height = 'max-h-72' }: { run: ActionRun; className?: string; height?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [run.output]);
  const cut = outputCut(run);
  return (
    <div className={className}>
      {cut && <div className="px-1.5 pb-1 text-[11.5px] text-fg-4">{cut}</div>}
      <pre
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className={`scroll-thin ${height} overflow-auto rounded-[14px] bg-surface-2 px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap break-words text-fg-2`}
      >
        {run.output || <span className="text-fg-4">{run.state === 'running' ? 'Waiting for output' : 'No output'}</span>}
      </pre>
    </div>
  );
}
