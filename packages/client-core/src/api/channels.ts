import type { ChannelKind } from '@omni/shared/channel-form.ts';
import { CHANNEL_THREADS_CURSOR, CHANNEL_THREADS_PAGE, readChannelThreadsPage, type ChannelThreadsPage } from '@omni/shared/channel-threads.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { Thread, ThreadStub } from './threads.ts';

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind | 'system';
  repo_path: string | null;
  github_repo: string | null;
  use_worktree: number;
  base_dir: string | null;
  store_domain: string | null;
  portal_slug: string | null;
  browser_headless: number;
  notes: string | null;
  icon: string | null;
  avatar_bg?: string | null;
  avatar_bg_manual?: number;
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
  /** The archived ones too, alongside the others. */
  archived?: boolean;
}

const archivedQuery = (o: ListArchived = {}) => ({ archived: o.archived ? '1' : undefined });

export function channelsApi(http: HttpClient) {
  return {
    channels: (o?: ListArchived) => http.request<ChannelWithRunning[]>('GET', apiPath`/channels`, { query: archivedQuery(o) }),
    channel: (id: string) => http.request<ChannelWithRunning>('GET', apiPath`/channels/${id}`),
    /** At most 200, most recently updated first, without team members. */
    channelThreads: (id: string, o?: ListArchived) => http.request<Thread[]>('GET', apiPath`/channels/${id}/threads`, { query: archivedQuery(o) }),
    /**
     * One page of a channel's threads, newest first; `cursor` is the previous page's `next`. A server from before paging
     * answers with its plain list of up to 200, read as one page with no next.
     */
    channelThreadsPage: async (id: string, cursor: string | null = null, limit = CHANNEL_THREADS_PAGE): Promise<ChannelThreadsPage<Thread>> =>
      readChannelThreadsPage<Thread>(
        await http.request<unknown>('GET', apiPath`/channels/${id}/threads`, { query: { paged: '1', limit: String(limit), [CHANNEL_THREADS_CURSOR]: cursor ?? undefined } }),
      ),
    /** Every folder, or one channel's. */
    folders: (channel?: string) => http.request<Folder[]>('GET', apiPath`/folders`, { query: { channel } }),
    /** Opens or closes a folder in every client's channel list: the server keeps the state. A 404 for a folder it does not have. */
    setFolderCollapsed: (id: string, collapsed: boolean) => http.request<Folder>('PATCH', apiPath`/folders/${id}`, { body: { collapsed } }),
    /** A new channel. `body` is `channelBody` from @omni/shared/channel-form.ts. A 409 when the id is taken. */
    createChannel: (id: string, body: Record<string, unknown>) => http.request<Channel>('POST', apiPath`/channels`, { body: { id, ...body } }),
    /** Changes any of a channel's fields, `archived` included. A 400 with the reason for a value it refuses. */
    updateChannel: (id: string, body: Record<string, unknown>) => http.request<Channel>('PATCH', apiPath`/channels/${id}`, { body }),
    /** Replaces the channel's design system with one standalone HTML file. */
    setDesignSystem: (id: string, name: string, html: string) => http.request<Channel>('PUT', apiPath`/channels/${id}/design-system`, { body: { name, html } }),
    removeDesignSystem: (id: string) => http.request<Channel>('DELETE', apiPath`/channels/${id}/design-system`),
  };
}
