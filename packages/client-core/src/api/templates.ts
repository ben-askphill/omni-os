import { apiPath, type HttpClient } from '../http.ts';
import type { TemplateList } from '@omni/shared/templates.ts';

export type { Template, TemplateList } from '@omni/shared/templates.ts';

/** GET /templates: the templates the New box offers. A server from before templates answers 404. */
export function templatesApi(http: HttpClient) {
  return {
    templates: () => http.request<TemplateList>('GET', apiPath`/templates`),
  };
}
