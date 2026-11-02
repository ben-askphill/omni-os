import { apiPath, type HttpClient } from '../http.ts';
import type { PendingMsg } from './messages.ts';
import type { Thread } from './threads.ts';

/** What every recovery route answers: the thread and its messages still waiting, as they are now. */
export interface Recovered {
  thread: Thread;
  pending: PendingMsg[];
}

export function recoveryApi(http: HttpClient) {
  return {
    /**
     * Sends messages a restart parked, in order. No ids: every recovered one. An uncertain one (it may have reached the
     * harness before the restart) is only sent again when named.
     */
    resumeRequests: (id: string, ids?: readonly string[]) =>
      http.request<Recovered>('POST', apiPath`/threads/${id}/requests/resume`, { body: ids ? { ids } : {} }),
    /** Drops parked messages. Each stays in the transcript, marked as never sent. At least one id. */
    discardRequests: (id: string, ids: readonly string[]) => http.request<Recovered>('POST', apiPath`/threads/${id}/requests/discard`, { body: { ids } }),
    /** Retries a worktree that could not be prepared. Safe to send twice. */
    retrySetup: (id: string) => http.request<Recovered>('POST', apiPath`/threads/${id}/setup/retry`),
    /** Schedules the one continuation of a turn stopped at its usage limit, for the reset time the harness gave. A 409 when it gave none. */
    scheduleLimit: (id: string) => http.request<Recovered>('POST', apiPath`/threads/${id}/limit/schedule`),
    cancelLimit: (id: string) => http.request<Recovered>('POST', apiPath`/threads/${id}/limit/cancel`),
    /** Sends the continuation now. */
    resumeLimit: (id: string) => http.request<Recovered>('POST', apiPath`/threads/${id}/limit/resume`),
  };
}
