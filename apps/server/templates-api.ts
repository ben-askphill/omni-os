// GET /api/templates: the templates the `/` menu and the New sheet offer (templates.ts). Its own app so tests can call
// it without starting the server.
import { Hono } from 'hono';
import { templateList } from './templates.ts';

export const templatesApi = new Hono();

templatesApi.get('/', (c) => c.json(templateList()));
