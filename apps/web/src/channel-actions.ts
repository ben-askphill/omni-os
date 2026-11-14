// A thread's channel actions and their runs (GET /api/threads/:id/actions). Runs have no push events, so the hook
// polls while one runs, or while the worktree is prepared, and the page is visible, and loads once otherwise.
import { useCallback, useEffect, useState } from 'react';
import {
  anyRunning,
  OUTPUT_LIMIT,
  SETUP_MODE_LABEL,
  type ActionRun,
  type ActionRunState,
  type ChannelAction,
  type ThreadActions,
  withRun,
} from '@omni/shared/channel-actions.ts';
import { bytes } from '@omni/shared/format.ts';
import { api, errorText, useApi, type Thread } from './api.ts';
import { duration } from './format.ts';

export const POLL_MS = 1000;

/** A run's state as the status glyph draws it. */
export const RUN_GLYPH: Record<ActionRunState, string> = { running: 'running', succeeded: 'done', failed: 'failed', stopped: 'stopped' };

/** "Port 9301 · 12s · exit 1": what a run's row says under its name. A running run counts up to `now`. */
export function runSummary(run: ActionRun, now = Date.now()) {
  const start = Date.parse(run.started_at);
  const end = run.ended_at ? Date.parse(run.ended_at) : now;
  return [
    run.port !== null && `Port ${run.port}`,
    Number.isFinite(start) && Number.isFinite(end) && duration(Math.max(0, end - start)),
    run.exit_code !== null && `exit ${run.exit_code}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Set when the start of the output was dropped. The byte count includes colour codes the kept text no longer has, so
 * it alone can run ahead of a short output; only a tail at the limit was cut.
 */
export function outputCut(run: ActionRun) {
  return run.output.length >= OUTPUT_LIMIT && run.output_bytes > run.output.length ? `Showing the last ${bytes(OUTPUT_LIMIT)} of ${bytes(run.output_bytes)}` : null;
}

// ---------- the setup action in a new worktree ----------

export type SetupStepId = 'clone' | 'checkout' | 'setup' | 'agent';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  /** The setup step's mode ("Before the agent starts"), or where the clone goes. */
  detail: string | null;
  state: 'done' | 'active' | 'todo';
}

/**
 * The steps of a worktree being prepared: a clone of the channel's repo while one runs, Checkout, the channel's setup
 * action when it has one, then Agent. The setup run appears once the checkout is made, so none means the checkout is
 * still going.
 */
export function setupSteps(data: ThreadActions | undefined): SetupStep[] {
  const run = data?.setup_run ?? null;
  const clone = data?.clone ?? null;
  const action = data?.actions.find((a) => a.id === run?.action_id) ?? data?.actions.find((a) => a.setup);
  const name = run?.name ?? action?.name;
  const mode = action?.setup;
  const active: SetupStepId = clone ? 'clone' : !run ? 'checkout' : run.state === 'succeeded' ? 'agent' : 'setup';
  const ids: SetupStepId[] = [...(clone ? ['clone' as const] : []), 'checkout', ...(name ? ['setup' as const] : []), 'agent'];
  const at = ids.indexOf(active);
  const label: Record<SetupStepId, string> = { clone: `Clone ${clone?.repo}`, checkout: 'Checkout', setup: `Setup "${name}"`, agent: 'Agent' };
  const detail: Record<SetupStepId, string | null> = { clone: clone ? `into ${clone.into}` : null, checkout: null, setup: mode ? SETUP_MODE_LABEL[mode] : null, agent: null };
  return ids.map((id, i) => ({ id, label: label[id], detail: detail[id], state: i < at ? 'done' : i === at ? 'active' : 'todo' }));
}

/** The setup run a ready thread shows on its strip: running alongside the agent, or failed. Run again replaces it. */
export function stripRun(data: ThreadActions | undefined): ActionRun | null {
  const run = data?.setup_run;
  return run && (run.state === 'running' || run.state === 'failed') ? run : null;
}

/** The setup card polls the whole time the worktree is prepared, and a ready thread's strip while its run runs. */
export const setupPolls = (setup: Thread['setup'], data: ThreadActions | undefined) =>
  setup === 'preparing' || (setup === null && stripRun(data)?.state === 'running');

function useVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * `busy` and `errors` are keyed by the action id for Run and the run id for Stop and Retry, so each shows on its own row.
 * It polls while `pollWhile` holds and the page is visible: by default while any run runs.
 */
export function useThreadActions(threadId: string, pollWhile: (data: ThreadActions | undefined) => boolean = anyRunning) {
  const base = `/threads/${encodeURIComponent(threadId)}`;
  const { data, error, loading, reload, setData } = useApi<ThreadActions>(`${base}/actions`);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const visible = useVisible();
  const poll = visible && pollWhile(data);

  // One request at a time: the next waits until the last one answered.
  useEffect(() => {
    if (!poll || loading) return;
    const t = setTimeout(reload, POLL_MS);
    return () => clearTimeout(t);
  }, [poll, loading, reload]);

  const send = useCallback(
    async (key: string, path: string): Promise<ActionRun | undefined> => {
      setBusy((s) => new Set(s).add(key));
      setErrors(({ [key]: _, ...rest }) => rest);
      try {
        const run = await api.post<ActionRun>(`${base}${path}`);
        // The buttons exist only once the list loaded, and the tab mounts once per thread, so `d` is this thread's.
        setData((d) => withRun(d!, run));
        return run;
      } catch (e) {
        setErrors((m) => ({ ...m, [key]: errorText(e) }));
      } finally {
        setBusy((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [base, setData],
  );

  return {
    data,
    error,
    loading,
    reload,
    busy,
    errors,
    run: (a: ChannelAction) => send(a.id, `/actions/${encodeURIComponent(a.id)}/run`),
    stop: (r: ActionRun) => send(r.id, `/action-runs/${encodeURIComponent(r.id)}/stop`),
    // Again of the setup run is the setup run, as the server records it.
    retry: async (r: ActionRun) => {
      const next = await send(r.id, `/action-runs/${encodeURIComponent(r.id)}/retry`);
      if (next) setData((d) => (d!.setup_run?.id === r.id ? { ...d!, setup_run: next } : d!));
      return next;
    },
  };
}
