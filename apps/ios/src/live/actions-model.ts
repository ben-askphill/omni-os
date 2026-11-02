import { OUTPUT_LIMIT, portLabel, RUN_STATE_LABEL, type ActionRun, type ActionRunState, type ChannelAction } from '@omni/shared/channel-actions.ts';

import { shortAgo } from './channel-model';

export { portLabel, RUN_STATE_LABEL };

/** "12s", "3m 4s", "1h 5m". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "Port 9301 · 12s · exit 1": what a run's row says under its name. A running run counts up to `now`. */
export function runSummary(run: ActionRun, now: number): string {
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
export function outputCut(run: ActionRun): string | null {
  return run.output.length >= OUTPUT_LIMIT && run.output_bytes > run.output.length ? `Showing the last ${bytes(OUTPUT_LIMIT)} of ${bytes(run.output_bytes)}` : null;
}

/** A run's state as a dot: going is solid, failed is a ring, finished is faint. */
export const runTone = (state: ActionRunState): 'ok' | 'warn' | 'muted' => (state === 'running' ? 'ok' : state === 'failed' ? 'warn' : 'muted');

export const actionDetail = (action: Pick<ChannelAction, 'port'>) => portLabel(action.port);

export const runWhen = (run: ActionRun, now: number) => [shortAgo(run.started_at, now), runSummary(run, now)].filter(Boolean).join(' · ');
