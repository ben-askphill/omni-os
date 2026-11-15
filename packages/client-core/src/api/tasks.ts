import { apiPath, type HttpClient } from '../http.ts';

/**
 * A background task a thread runs: a sub-agent, a workflow, a background shell or a monitor (apps/web/src/api.ts
 * BackgroundTask). GET /tasks lists the live ones, and the feed's `tasks` message repeats the whole list on each change.
 */
export interface BackgroundTask {
  thread_id: string;
  channel_id: string;
  /** The team lead a member thread runs under. */
  lead_id?: string;
  task_id: string;
  description: string;
  subagent_type?: string;
  /** An agent the thread spawned (Agent call, workflow, fork, teammate), not a background shell or monitor. */
  subagent: boolean;
  background: boolean;
  /** ISO time. */
  started_at: string;
  tool_uses?: number;
}

export function tasksApi(http: HttpClient) {
  return {
    /** The tasks running now, on every thread. */
    tasks: () => http.request<BackgroundTask[]>('GET', apiPath`/tasks`),
  };
}
