import type { ContinueLink } from '@omni/shared/continue.ts';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { historyQuery, type HistoryCursor, type HistoryHead, type HistoryPage } from '@omni/shared/history.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { Channel } from './channels.ts';
import type { Artifact, EventRow, HistoryEvent, ModStatus } from './events.ts';
import type { PendingMsg } from './messages.ts';
import type { Thread } from './threads.ts';

/** GET /threads/:id?history=recent: the thread with its newest page of events. Older servers send every event and no `history`. */
export interface ThreadOpen {
  thread: Thread;
  /** Absent when the thread's channel is gone. */
  channel?: Channel;
  events: HistoryEvent[];
  history?: HistoryHead;
  artifacts: Artifact[];
  children: Thread[];
  team?: Thread[];
  parent: Thread | null;
  pending?: PendingMsg[];
  /** A warm CLI process is attached, so the next message starts at once. */
  live?: boolean;
  mods?: ModStatus[];
  /** Why this Mac cannot start a turn in the thread. */
  blocked?: string;
  handoff?: HandoffView | null;
  takeover?: Takeover;
  continued_from?: ContinueLink | null;
  continued_in?: ContinueLink[];
}

export function detailApi(http: HttpClient) {
  return {
    thread: (id: string) => http.request<ThreadOpen>('GET', apiPath`/threads/${id}`, { query: { history: 'recent' } }),
    history: (id: string, cursor: HistoryCursor) => http.request<HistoryPage<HistoryEvent>>('GET', apiPath`/threads/${id}/history`, { query: historyQuery(cursor) }),
    event: (id: string, eventId: number) => http.request<EventRow>('GET', apiPath`/threads/${id}/events/${eventId}`),
  };
}
