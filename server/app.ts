import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { paths } from './config.ts';
import { artifactsApi } from './artifacts-api.ts';
import { browserApi } from './browser-api.ts';
import { channelsApi } from './channels-api.ts';
import { foldersApi } from './folders-api.ts';
import { commandsApi } from './commands-api.ts';
import { mentionsApi } from './mentions-api.ts';
import { feedApi } from './feed-api.ts';
import { githubApi } from './github-api.ts';
import { metaApi } from './meta-api.ts';
import { syncApi } from './sync-api.ts';
import { terminalApi } from './terminal-api.ts';
import { threadActionsApi, threadRoutesApi } from './thread-routes-api.ts';
import { threadsApi } from './threads-api.ts';

// Every /api route, and the Web UI. server/index.ts boots it.
export const app = new Hono();
const api = new Hono();

app.onError((err, c) => {
  console.error('[api]', err);
  const status = err instanceof z.ZodError ? 400 : ((err as { status?: number }).status ?? 500);
  return c.json({ error: err.message }, status as 400);
});

// Mounted in the same order the handlers used to be registered. Hono runs the first match, so
// threadsApi and terminalApi stay between the thread reads and the message, upload, stop, and stream routes.
api.route('/channels', channelsApi);
api.route('/channels', browserApi);
api.route('/folders', foldersApi);
api.route('/threads', threadRoutesApi);
api.route('/threads', threadsApi);
api.route('/threads', terminalApi);
api.route('/threads', threadActionsApi);
api.route('/', feedApi);
api.route('/artifacts', artifactsApi);
api.route('/', githubApi);
api.route('/', metaApi);
api.route('/commands', commandsApi);
api.route('/mentions', mentionsApi);
api.route('/sync', syncApi);

// Last, so only a request no route above takes lands here, and never on the Web UI's index.html.
api.all('*', (c) => c.json({ error: 'Not found' }, 404));

app.route('/api', api);

// ---------- web ----------

if (existsSync(paths.webDist)) {
  app.use('/*', serveStatic({ root: paths.webDist }));
  app.get('*', (c) => c.html(readFileSync(`${paths.webDist}/index.html`, 'utf8')));
}
