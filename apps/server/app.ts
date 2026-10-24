import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { paths } from './config.ts';
import { artifactsApi } from './artifacts-api.ts';
import { authApi } from './auth-api.ts';
import { browserApi } from './browser-api.ts';
import { changesApi } from './changes-api.ts';
import { channelsApi } from './channels-api.ts';
import { foldersApi } from './folders-api.ts';
import { commandsApi } from './commands-api.ts';
import { mentionsApi } from './mentions-api.ts';
import { feedApi } from './feed-api.ts';
import { githubApi } from './github-api.ts';
import { githubWebhookApi } from './github-webhook-api.ts';
import { automationDeliveriesApi } from './automation-deliveries-api.ts';
import { grokbotApi } from './grokbot.ts';
import { linksApi } from './links-api.ts';
import { metaApi } from './meta-api.ts';
import { setupApi } from './setup-api.ts';
import { syncApi } from './sync-api.ts';
import { terminalApi } from './terminal-api.ts';
import { threadActionsApi, threadRoutesApi } from './thread-routes-api.ts';
import { questionsApi } from './questions-api.ts';
import { threadsApi } from './threads-api.ts';
import { requestGuard } from './request-guard.ts';
import { toolFailuresApi } from './tool-failures-api.ts';

// Every /api route, and the Web UI. apps/server/index.ts boots it.
export const app = new Hono();
const api = new Hono();

app.onError((err, c) => {
  console.error('[api]', err);
  const status = err instanceof z.ZodError ? 400 : ((err as { status?: number }).status ?? 500);
  return c.json({ error: err.message }, status as 400);
});

// Ahead of every route: refuses requests without this install's token, and those other sites make through a browser
// (apps/server/request-guard.ts). The Web UI below is served without either: it holds no secret, and pairs to get one.
api.use('*', requestGuard);

// Mounted in the same order the handlers used to be registered. Hono runs the first match, so
// threadsApi and terminalApi stay between the thread reads and the message, upload, stop, and stream routes.
api.route('/auth', authApi);
api.route('/channels', channelsApi);
api.route('/channels', browserApi);
api.route('/folders', foldersApi);
api.route('/threads', threadRoutesApi);
api.route('/threads', threadsApi);
api.route('/threads', terminalApi);
api.route('/threads', changesApi);
api.route('/threads', threadActionsApi);
api.route('/threads', questionsApi);
api.route('/', feedApi);
api.route('/artifacts', artifactsApi);
api.route('/', githubApi);
api.route('/', githubWebhookApi);
api.route('/', automationDeliveriesApi);
api.route('/', metaApi);
api.route('/commands', commandsApi);
api.route('/mentions', mentionsApi);
api.route('/links', linksApi);
api.route('/grokbot', grokbotApi);
api.route('/sync', syncApi);
api.route('/setup', setupApi);
api.route('/tool-failures', toolFailuresApi);

// Last, so only a request no route above takes lands here, and never on the Web UI's index.html.
api.all('*', (c) => c.json({ error: 'Not found' }, 404));

app.route('/api', api);

// ---------- web ----------

if (existsSync(paths.webDist)) {
  app.use('/*', serveStatic({ root: paths.webDist }));
  app.get('*', (c) => c.html(readFileSync(`${paths.webDist}/index.html`, 'utf8')));
}
