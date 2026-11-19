import type { BackgroundTask } from './api.ts';
import { plural } from './format.ts';

/**
 * The agents a thread spawned itself that still run, oldest first: Agent calls, workflows, forks. Background shells
 * and monitors are tasks too but not agents, and a delegated thread's agents are listed on that thread.
 */
export const runningSubagents = (tasks: BackgroundTask[], threadId: string) =>
  tasks.filter((t) => t.thread_id === threadId && t.subagent).sort((a, b) => a.started_at.localeCompare(b.started_at));

const KIND: Record<string, string> = {
  local_workflow: 'workflow',
  remote_agent: 'remote',
  in_process_teammate: 'teammate',
};

/** What kind of agent it is: its sub-agent type, else what the CLI calls the task. */
export const subagentKind = (t: BackgroundTask): string | undefined => t.subagent_type || KIND[t.task_type ?? ''];

/** How far it got, shown on its row: in the background, its tool calls and the last one. Empty before its first call. */
export const subagentProgress = (t: BackgroundTask) =>
  [t.background ? 'in the background' : null, t.tool_uses ? plural(t.tool_uses, 'tool call') : null, t.last_tool && `last ${t.last_tool}`]
    .filter(Boolean)
    .join(' · ');

/** A row's tooltip on desktop: what it does, how far it got, and where a click goes. */
export const subagentTip = (t: BackgroundTask) =>
  [t.description, subagentProgress(t)].filter(Boolean).join(' · ') + (t.event_id ? '\nJump to where it started' : '');
