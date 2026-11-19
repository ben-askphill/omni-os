import { apiPath, type HttpClient } from '../http.ts';
import type { Memory } from '@omni/shared/memory.ts';

export type { Memory } from '@omni/shared/memory.ts';

/** A channel's Recent learnings: GET, POST, PATCH and DELETE /memory. A server from before them answers 404. */
export function memoryApi(http: HttpClient) {
  return {
    learnings: (channel: string) => http.request<{ learnings: Memory[]; waiting: number }>('GET', apiPath`/memory`, { query: { channel } }),
    addLearning: (channel: string, text: string) => http.request<Memory>('POST', apiPath`/memory`, { body: { channel, text } }),
    updateLearning: (id: string, change: { text?: string; approve?: boolean }) => http.request<Memory>('PATCH', apiPath`/memory/${id}`, { body: change }),
    removeLearning: (id: string) => http.request<{ ok: true }>('DELETE', apiPath`/memory/${id}`),
  };
}
