import { apiPath, type HttpClient } from '../http.ts';

/** A thread whose title or messages match. A body hit carries the snippet and the event it matched. */
export interface SearchHit {
  thread_id: string;
  title: string;
  channel_id: string;
  status: string;
  updated_at: string;
  /** Matched words sit between `<mark>` and `</mark>`. Empty for a thread only its title matched. */
  snippet: string;
  /** The event a body hit matched. Null for a thread only its title matched. */
  event_id: number | null;
}

export function searchApi(http: HttpClient) {
  return {
    /** Threads whose title or messages match every word of `q`, best match first. An empty query returns nothing. */
    search: (q: string) => http.request<SearchHit[]>('GET', apiPath`/search`, { query: { q } }),
  };
}
