import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ActionRun, ThreadActions } from '@omni/shared/channel-actions.ts';
import { api, errorText, type PendingMsg, type Thread } from '../../api.ts';
import { runSummary, setupPolls, setupSteps, stripRun, useThreadActions } from '../../channel-actions.ts';
import { isRemoteHarness } from '../../worktree-base.ts';
import { useBranchingFrom } from '../BasePicker.tsx';
import { Button, ErrorNote, Icon, Loader, StatusDot } from '../ui.tsx';
import { RunOutput } from './panel/ActionsTab.tsx';

type Props = { thread: Thread; onRetried: (t: Thread, pending: PendingMsg[]) => void; mobile?: boolean };

/**
 * A worktree thread whose worktree is not ready (apps/server/runner/setup.ts and setup-action.ts): Preparing through
 * Checkout, the channel's setup action and Agent, with Stop, then Setup failed or Setup stopped with the reason and
 * Retry setup. Nothing runs until it is ready, and the first message and its files wait below, kept across restarts.
 * Retry uses the same thread, branch and session. Once the thread is ready, a setup action running alongside the agent
 * shows here as a strip until it succeeds.
 */
export function SetupCard(props: Props) {
  const { thread } = props;
  // A thread off this Mac never gets a worktree, and one without a branch never has one to set up.
  if (!thread.setup && (isRemoteHarness(thread.harness) || !thread.branch)) return null;
  return <SetupView key={thread.id} {...props} />;
}

function SetupView({ thread, onRetried, mobile }: Props) {
  const { data, reload, busy, errors, stop, retry } = useThreadActions(thread.id, (d) => setupPolls(thread.setup, d));

  // The thread stream says when preparation moves on; the setup run's final state comes with the next read.
  const was = useRef(thread.setup);
  useEffect(() => {
    if (was.current !== thread.setup) reload();
    was.current = thread.setup;
  }, [thread.setup, reload]);

  if (thread.setup === 'preparing') return <Preparing thread={thread} data={data} mobile={mobile} />;
  if (thread.setup === 'failed') return <Failed thread={thread} data={data} onRetried={onRetried} mobile={mobile} />;
  const run = stripRun(data);
  if (!run) return null;
  return (
    <Strip
      run={run}
      busy={busy.has(run.id)}
      error={errors[run.id]}
      mobile={mobile}
      onStop={() => void stop(run)}
      onAgain={() => void retry(run)}
    />
  );
}

function Preparing({ thread, data, mobile }: { thread: Thread; data: ThreadActions | undefined; mobile?: boolean }) {
  // Busy until the thread leaves preparing, which unmounts this: Stop answers at once, the run takes up to seconds to end.
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = setupSteps(data);
  const run = data?.setup_run;

  const stopIt = async () => {
    setStopping(true);
    setError(null);
    try {
      await api.post(`/threads/${encodeURIComponent(thread.id)}/stop`);
    } catch (e) {
      setError(errorText(e));
      setStopping(false);
    }
  };

  return (
    <Frame
      thread={thread}
      mobile={mobile}
      failed={false}
      title="Preparing worktree"
      text="Nothing runs before the agent starts. Your message and files wait below."
      button={
        <Button size="sm" icon="stop" busy={stopping} onClick={() => void stopIt()} className="shrink-0">
          {stopping ? 'Stopping' : 'Stop'}
        </Button>
      }
      error={error}
    >
      <ol aria-label="Steps" className="mt-2.5 space-y-1.5">
        {steps.map((s) => (
          <li key={s.id} aria-current={s.state === 'active' ? 'step' : undefined} className="flex min-w-0 items-center gap-2 text-[12.5px] leading-snug">
            <StatusDot status={s.state === 'done' ? 'done' : s.state === 'active' ? 'running' : 'idle'} size={7} className="shrink-0" />
            <span className={`min-w-0 truncate ${s.state === 'todo' ? 'text-fg-4' : 'text-fg-2'} ${s.state === 'active' ? 'font-medium text-fg' : ''}`}>{s.label}</span>
            {s.detail && <span className="min-w-0 truncate text-fg-4">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {run?.state === 'running' && <RunOutput run={run} className="mt-2.5" height="max-h-44" />}
    </Frame>
  );
}

function Failed({ thread, data, onRetried, mobile }: { thread: Thread; data: ThreadActions | undefined; onRetried: Props['onRetried']; mobile?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = data?.setup_run;

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ thread: Thread; pending: PendingMsg[] }>(`/threads/${encodeURIComponent(thread.id)}/setup/retry`, {});
      onRetried(res.thread, res.pending);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      thread={thread}
      mobile={mobile}
      failed
      title={thread.status === 'stopped' ? 'Setup stopped' : 'Setup failed'}
      text="The agent did not start. Your message and files are kept and send once the worktree is ready."
      button={
        <Button size="sm" variant="primary" icon="refresh" busy={busy} onClick={() => void retry()} className="shrink-0">
          Retry setup
        </Button>
      }
      error={error}
    >
      {thread.setup_error && (
        <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5] break-words whitespace-pre-wrap text-fg-2">{thread.setup_error}</p>
      )}
      {run && run.state !== 'running' && run.state !== 'succeeded' && <RunOutput run={run} className="mt-2" height="max-h-56" />}
    </Frame>
  );
}

function Frame({
  thread,
  mobile,
  failed,
  title,
  text,
  button,
  error,
  children,
}: {
  thread: Thread;
  mobile?: boolean;
  failed: boolean;
  title: string;
  text: string;
  button: ReactNode;
  error: string | null;
  children: ReactNode;
}) {
  const from = useBranchingFrom(thread);
  return (
    <section
      aria-label={title}
      role={failed ? 'alert' : 'status'}
      className={`pop-in overflow-hidden bg-surface ${mobile ? 'rounded-[20px]' : 'mt-5 rounded-2xl border border-line'}`}
    >
      <div className={`flex items-start gap-3 ${mobile ? 'p-3.5' : 'px-4 py-3'}`}>
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${failed ? 'bg-needs/12 text-needs' : 'bg-surface-2 text-fg-3'}`}>
          {failed ? <Icon name="alert" size={15} /> : <Loader size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className={`${mobile ? 'text-[15px]' : 'text-[14px]'} leading-snug font-semibold`}>{title}</h3>
              <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-3">{text}</p>
            </div>
            {button}
          </div>
          {children}
          {thread.branch && (
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-4">
              <Icon name="branch" size={12} className="shrink-0" />
              <span className="truncate font-mono" title={thread.cwd}>
                {thread.branch}
              </span>
            </div>
          )}
          {from && <p className="mt-1 text-[11.5px] text-fg-4">{from}</p>}
        </div>
      </div>
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
    </section>
  );
}

/** A ready thread's setup action, running alongside the agent or failed after it started. */
function Strip({
  run,
  busy,
  error,
  mobile,
  onStop,
  onAgain,
}: {
  run: ActionRun;
  busy: boolean;
  error: string | undefined;
  mobile?: boolean;
  onStop: () => void;
  onAgain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const running = run.state === 'running';
  return (
    <section
      aria-label="Setup"
      role={running ? 'status' : 'alert'}
      className={`pop-in overflow-hidden bg-surface ${mobile ? 'rounded-[20px]' : 'mt-5 rounded-2xl border border-line'}`}
    >
      <div className={`flex items-center gap-2 ${mobile ? 'py-2.5 pr-3 pl-2' : 'py-2 pr-3 pl-2'}`}>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="hov flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] px-1.5 py-1 text-left">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${running ? 'bg-surface-2 text-fg-3' : 'bg-needs/12 text-needs'}`}>
            {running ? <Loader size={14} /> : <Icon name="alert" size={15} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-snug font-medium text-fg">
              {running ? `Setup "${run.name}" is running alongside the agent` : `Setup "${run.name}" failed`}
            </span>
            <span className="mt-0.5 flex items-center gap-1 font-num text-[11.5px] text-fg-3">
              <span className="truncate">{[runSummary(run), open ? 'Hide output' : 'Show output'].filter(Boolean).join(' · ')}</span>
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="shrink-0 text-fg-4" />
            </span>
          </span>
        </button>
        {running ? (
          <Button size="sm" icon="stop" busy={busy} onClick={onStop} className="shrink-0">
            Stop
          </Button>
        ) : (
          <Button size="sm" icon="refresh" busy={busy} onClick={onAgain} className="shrink-0">
            Run again
          </Button>
        )}
      </div>
      {run.error && !running && <p className="px-4 pb-2 text-[12px] leading-snug text-fg-2">{run.error}</p>}
      {error && <ErrorNote className="mx-3 mb-3">{error}</ErrorNote>}
      {open && <RunOutput run={run} className="px-3 pb-3" height="max-h-56" />}
    </section>
  );
}
