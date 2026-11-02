import type { Run } from '@omni/shared/run-switch.ts';
import type { BasePick } from '@omni/shared/worktree-base.ts';
import { apiPath, sendWithFiles, type HttpClient, type WithFiles } from '../http.ts';

export type ThreadStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'imported';
export type ThreadSource = 'manual' | 'automation' | 'conductor' | 'import' | 'capture' | 'team';

/** A thread row, as every thread endpoint sends it. */
export interface Thread {
  id: string;
  channel_id: string;
  title: string;
  status: ThreadStatus;
  role: string | null;
  model: string | null;
  harness: string;
  /** Empty: the model's default. */
  effort: string;
  auto_reason: string | null;
  /** The run picked during a turn, applied once the thread is quiet. Null when none waits. */
  queued_harness: string | null;
  queued_model: string | null;
  queued_effort: string | null;
  session_id: string;
  has_run: number;
  cwd: string;
  branch: string | null;
  parent_id: string | null;
  task_id: string | null;
  source: ThreadSource;
  automation: string | null;
  last_text: string | null;
  suggestion: string | null;
  next_title: string | null;
  next_prompt: string | null;
  archived: number;
  folder_id: string | null;
  pinned_at: string | null;
  done_at: string | null;
  setup: 'preparing' | 'failed' | null;
  setup_error: string | null;
  resume_blocked: string | null;
  limit_state: 'limited' | 'scheduled' | null;
  limit_resets_at: string | null;
  limit_elsewhere: number;
  continued_from: string | null;
  created_at: string;
  updated_at: string;
}

/** The part of a thread the channel list sends for each of its threads. */
export type ThreadStub = Pick<Thread, 'id' | 'channel_id' | 'title' | 'status' | 'created_at' | 'updated_at' | 'folder_id' | 'harness' | 'pinned_at' | 'done_at' | 'parent_id' | 'source'>;

export interface ListThreads {
  channel?: string;
  status?: ThreadStatus;
  /** The server's default is 50. */
  limit?: number;
}

/** POST /threads, without files. A field left out takes the role's, then the channel's default, then Auto. */
export interface CreateThreadRequest {
  /**
   * A uuid the client picks. The server makes the thread under it once, so a retry after a lost reply gets the same thread
   * back and sends the first message once. Keep it across retries of one request and pick a new one when the request changes.
   */
  id?: string;
  /** Left out: `inbox`. */
  channel?: string;
  /** The first message, not empty. */
  prompt: string;
  /** Left out: generated from the prompt. */
  title?: string;
  role?: string;
  harness?: string;
  model?: string;
  effort?: string;
  /** A folder of the channel, by id or name, at most 200 characters. A name no folder has makes one. */
  folder?: string;
  /** Where a worktree thread's branch starts. Left out: the repo's HEAD. */
  base?: BasePick;
  /** A synced machine's id, or `here`. Left out: Settings' default. */
  device?: string;
}

/** PATCH /threads/:id takes any of these at once. The thread's run (model, effort, harness) goes through `switchRun`. */
export interface ThreadPatch {
  /** One line, 1 to 200 characters after the server trims it. */
  title?: string;
  archived?: boolean;
  /** A folder of the thread's own channel. Null takes it out of its folder. */
  folder_id?: string | null;
  pinned?: boolean;
  done?: boolean;
}

export function threadsApi(http: HttpClient) {
  const patch = (id: string, body: ThreadPatch) => http.request<Thread>('PATCH', apiPath`/threads/${id}`, { body });
  return {
    threads: (o: ListThreads = {}) => http.request<Thread[]>('GET', apiPath`/threads`, { query: { ...o } }),
    /** Starts its first turn, or its worktree's setup. On another machine, the thread here is `stopped`. */
    createThread: (body: CreateThreadRequest, withFiles?: WithFiles) => sendWithFiles<Thread>(http, 'POST', apiPath`/threads`, body, withFiles),
    /** Any of the edits at once. A 409 for pinning an archived thread or marking a running or queued one done. */
    patchThread: patch,
    /** A 409 for a running or queued thread. */
    setDone: (id: string, done: boolean) => patch(id, { done }),
    /** A 409 for an archived thread. */
    setPinned: (id: string, pinned: boolean) => patch(id, { pinned }),
    rename: (id: string, title: string) => patch(id, { title }),
    /** Archiving also unpins it. */
    setArchived: (id: string, archived: boolean) => patch(id, { archived }),
    /** A folder of the thread's channel, or null for the ungrouped list. A 4xx for another channel's folder. */
    moveToFolder: (id: string, folderId: string | null) => patch(id, { folder_id: folderId }),
    /** The model, effort and harness. Between turns it applies at once; during one it waits. A 409 while another machine runs the thread. */
    switchRun: (id: string, run: Run) => http.request<Thread>('POST', apiPath`/threads/${id}/run`, { body: run }),
  };
}
