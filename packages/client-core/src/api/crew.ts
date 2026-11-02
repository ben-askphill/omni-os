import { apiPath, type HttpClient } from '../http.ts';

/** A crew role: a charter with the run it defaults to. A new thread can start as one (`createThread`'s `role`). */
export interface CrewRole {
  id: string;
  name: string;
  description: string;
  harness?: string;
  model?: string;
  effort?: string;
  channel?: string;
  mcp: string[];
  charter: string;
  /** Why the role's own run defaults are unusable, when they are. */
  error?: string;
}

export function crewApi(http: HttpClient) {
  return {
    crew: () => http.request<CrewRole[]>('GET', apiPath`/crew`),
  };
}
