import { apiPath, type HttpClient } from '../http.ts';
import type { Thread, ThreadStub } from './threads.ts';

export interface Channel {
  id: string;
  name: string;
  kind: 'client' | 'internal' | 'personal' | 'system';
  repo_path: string | null;
  github_repo: string | null;
  use_worktree: number;
  base_dir: string | null;
  store_domain: string | null;
  portal_slug: string | null;
  browser_headless: number;
  notes: string | null;
  icon: string | null;
  default_harness: string | null;
  default_model: string | null;
  default_effort: string | null;
  design_system_name: string | null;
  design_system_size: number;
  archived: number;
  created_at: string;
}

export interface Folder {
  id: string;
  channel_id: string;
  parent_id: string | null;
  name: string;
  /** Null while the channel's folders sort by name. */
  position: number | null;
  collapsed: number;
  created_at: string;
  updated_at: string;
}

export type FolderWithThreads = Folder & { count: number; running: number; threads: ThreadStub[] };

/**
 * GET /channels and /channels/:id. `active`: running and queued threads, and those whose sub-agents still run.
 * `recent`: the latest threads of any status. `handoffs`: only on the Conductor channel. Older servers leave the lists out.
 */
export type ChannelWithRunning = Channel & {
  running: number;
  active?: ThreadStub[];
  recent?: ThreadStub[];
  folders?: FolderWithThreads[];
  handoffs?: { parent: ThreadStub; children: ThreadStub[] }[];
};

export interface ListArchived {
  /** Only the archived ones, in place of the others. */
  archived?: boolean;
}

const archivedQuery = (o: ListArchived = {}) => ({ archived: o.archived ? '1' : undefined });

export function channelsApi(http: HttpClient) {
  return {
    channels: (o?: ListArchived) => http.request<ChannelWithRunning[]>('GET', apiPath`/channels`, { query: archivedQuery(o) }),
    channel: (id: string) => http.request<ChannelWithRunning>('GET', apiPath`/channels/${id}`),
    /** At most 200, most recently updated first, without team members. */
    channelThreads: (id: string, o?: ListArchived) => http.request<Thread[]>('GET', apiPath`/channels/${id}/threads`, { query: archivedQuery(o) }),
    /** Every folder, or one channel's. */
    folders: (channel?: string) => http.request<Folder[]>('GET', apiPath`/folders`, { query: { channel } }),
    /** Opens or closes a folder in every client's channel list: the server keeps the state. A 404 for a folder it does not have. */
    setFolderCollapsed: (id: string, collapsed: boolean) => http.request<Folder>('PATCH', apiPath`/folders/${id}`, { body: { collapsed } }),
  };
}
