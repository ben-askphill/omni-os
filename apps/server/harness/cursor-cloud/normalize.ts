// Cursor cloud agent runs into Omni records. Pure, so the status mapping is testable without the API.
import type { CloudAgentState, Record as StreamRecord } from '../../stream.ts';
import type { CursorAgent, CursorRun, RunStatus } from './client.ts';

export const TERMINAL = new Set<RunStatus>(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);

/** The agent on cursor.com: the API's own URL, else the one every agent id has. */
export const agentUrl = (agent: Pick<CursorAgent, 'id' | 'url'>) => agent.url || `https://cursor.com/agents/${agent.id}`;

/** Where the agent stands after a run update: its status, and the branch and PR it pushed to the channel's repo. */
export function stateOf(prev: CloudAgentState, run: CursorRun): CloudAgentState {
  const branches = run.git?.branches ?? [];
  const repo = prev.repo.toLowerCase();
  const mine = branches.filter((b) => b.repoUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '').endsWith(repo));
  const pool = mine.length ? mine : branches;
  const pick = pool.find((b) => b.prUrl) ?? pool[pool.length - 1];
  return {
    ...prev,
    run_id: run.id,
    status: run.status,
    ...(pick?.branch && { branch: pick.branch }),
    ...(pick?.prUrl && { pr_url: pick.prUrl }),
  };
}

/** Whether a new state is worth a transcript row: the status, run, branch or PR moved. */
export const changed = (a: CloudAgentState | null, b: CloudAgentState) =>
  !a || a.status !== b.status || a.run_id !== b.run_id || a.branch !== b.branch || a.pr_url !== b.pr_url;

/** The spinner's label while the run is live. */
export function statusText(status: RunStatus): string {
  return status === 'CREATING' ? 'Cursor cloud agent is starting' : 'Cursor cloud agent is working';
}

/**
 * The line under the agent's reply, so a crew report carries where the work landed. Bare URLs: the thread list shows
 * the reply's start as plain text, and the transcript links them anyway.
 */
export function footer(s: CloudAgentState): string {
  const parts = [`Cursor cloud agent: ${s.url}`];
  if (s.pr_url) parts.push(`PR: ${s.pr_url}`);
  else if (s.branch) parts.push(`branch \`${s.branch}\``);
  return parts.join(' · ');
}

/**
 * The records that end a turn on a run that ended: its reply with the footer, why it failed when it did, and the
 * result. FINISHED is the only success. CANCELLED is a stop, which the runner marks stopped when Ben asked for it.
 */
export function endRecords(s: CloudAgentState, run: CursorRun): StreamRecord[] {
  const out: StreamRecord[] = [];
  const reply = run.result?.trim();
  out.push({ kind: 'assistant_text', payload: { text: reply ? `${reply}\n\n${footer(s)}` : footer(s) } });
  if (run.status === 'ERROR') out.push({ kind: 'error', payload: { text: `The Cursor cloud agent stopped with an error. Its log is on cursor.com: ${s.url}` } });
  if (run.status === 'EXPIRED') out.push({ kind: 'error', payload: { text: `The Cursor cloud agent's run expired before it finished: ${s.url}` } });
  out.push({
    kind: 'result',
    payload: {
      ok: run.status === 'FINISHED',
      subtype: run.status === 'FINISHED' ? 'success' : run.status.toLowerCase(),
      turns: 1,
      ...(run.durationMs != null && { duration_ms: run.durationMs }),
    },
  });
  return out;
}
