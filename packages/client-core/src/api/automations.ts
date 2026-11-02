import { apiPath, type HttpClient } from '../http.ts';

/** The part of an automation the phone shows. The server sends more: the prompt, the last runs and the deliveries. */
export interface Automation {
  id: string;
  name: string;
  /** Empty for an event automation. */
  cron: string;
  /** Set for an event automation: it runs when this happens instead of on a schedule. */
  on?: { event: string; repo?: string | null };
  /** The repo a PR automation watches. */
  repo?: string | null;
  timezone: string;
  channel: string;
  enabled: boolean;
  /** Why the automation cannot run, such as a bad cron or an unknown model. */
  error?: string;
  /** The next scheduled run, as an ISO time. */
  next?: string | null;
}

export function automationsApi(http: HttpClient) {
  return {
    automations: () => http.request<Automation[]>('GET', apiPath`/automations`),
    setAutomationEnabled: (id: string, enabled: boolean) =>
      http.request<{ ok: true }>('POST', apiPath`/automations/${id}/enabled`, { body: { enabled } }),
  };
}
