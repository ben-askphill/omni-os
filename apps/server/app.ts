import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { paths } from './config.ts';
// The runner's ports are bound before any route can reach it (apps/server/compose.ts).
import './compose.ts';
import { artifactsApi } from './artifacts-api.ts';
import { authApi } from './auth-api.ts';
import { capabilitiesApi } from './capabilities-api.ts';
import { browserApi } from './browser-api.ts';
import { changesApi } from './changes-api.ts';
import { continueApi } from './continue-api.ts';
import { transitionsApi } from './transitions-api.ts';
import { channelsApi } from './channels-api.ts';
import { actionsApi } from './actions-api.ts';
import { foldersApi } from './folders-api.ts';
import { commandsApi } from './commands-api.ts';
import { mentionsApi } from './mentions-api.ts';
import { referencedHistoryApi, threadReferencesApi } from './thread-references-api.ts';
import { feedApi } from './feed-api.ts';
import { githubApi } from './github-api.ts';
import { githubWebhookApi } from './github-webhook-api.ts';
import { automationDeliveriesApi } from './automation-deliveries-api.ts';
import { prWatchApi } from './pr-watch/api.ts';
import { grokbotApi } from './grokbot.ts';
import { linksApi } from './links-api.ts';
import { mcpApi } from './mcp-api.ts';
import { oauthMetadataApi } from './mcp-oauth.ts';
import { metaApi } from './meta-api.ts';
import { setupApi } from './setup-api.ts';
import { syncApi } from './sync-api.ts';
import { terminalApi } from './terminal-api.ts';
import { threadActionsApi, threadRoutesApi } from './thread-routes-api.ts';
import { questionsApi } from './questions-api.ts';
import { rendersApi } from './renders-api.ts';
import { threadHistoryApi } from './thread-history-api.ts';
import { toolOutputApi } from './tool-output-api.ts';
import { threadsApi } from './threads-api.ts';
import { connectApi } from './connect-api.ts';
import { connectHostname } from './connect/service.ts';
import { requestGuard, useConnectHost, useSessionCheck } from './request-guard.ts';
import { sessionFor } from './google-auth.ts';
import { toolFailuresApi } from './tool-failures-api.ts';
import { worktreesApi } from './worktrees-api.ts';
import { updateApi } from './update-api.ts';

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
useSessionCheck(sessionFor);
useConnectHost(connectHostname);
api.use('*', requestGuard);

// Mounted in the same order the handlers used to be registered. Hono runs the first match, so
// threadsApi and terminalApi stay between the thread reads and the message, upload, stop, and stream routes.
api.route('/auth', authApi);
api.route('/capabilities', capabilitiesApi);
api.route('/channels', channelsApi);
api.route('/channels', browserApi);
api.route('/', actionsApi);
api.route('/folders', foldersApi);
api.route('/threads', threadRoutesApi);
api.route('/threads', threadsApi);
api.route('/threads', terminalApi);
api.route('/threads', changesApi);
api.route('/threads', threadActionsApi);
api.route('/threads', referencedHistoryApi);
api.route('/threads', questionsApi);
api.route('/threads', rendersApi);
api.route('/threads', continueApi);
api.route('/threads', transitionsApi);
api.route('/threads', threadHistoryApi);
api.route('/threads', toolOutputApi);
api.route('/', feedApi);
api.route('/artifacts', artifactsApi);
api.route('/', githubApi);
api.route('/', githubWebhookApi);
api.route('/', automationDeliveriesApi);
api.route('/', prWatchApi);
api.route('/', metaApi);
api.route('/commands', commandsApi);
api.route('/mentions', mentionsApi);
api.route('/thread-references', threadReferencesApi);
api.route('/links', linksApi);
api.route('/grokbot', grokbotApi);
api.route('/sync', syncApi);
api.route('/connect', connectApi);
api.route('/setup', setupApi);
api.route('/tool-failures', toolFailuresApi);
api.route('/worktrees', worktreesApi);
api.route('/update', updateApi);

// Last, so only a request no route above takes lands here, and never on the Web UI's index.html.
api.all('*', (c) => c.json({ error: 'Not found' }, 404));

app.route('/api', api);

// The external MCP server, outside /api: it checks its own token (apps/server/mcp-api.ts) and its tools come back in
// through /api, guard and all.
app.route('/mcp', mcpApi((path, init) => app.request(path, init)));
// Its OAuth metadata, where MCP clients look for it: RFC 9728 puts it at the root, not under /mcp.
app.route('/.well-known', oauthMetadataApi);

// ---------- web ----------

if (existsSync(paths.webDist)) {
  // index.html names this build's hashed assets, so a browser revalidates it on every load and picks up a rebuild.
  // Without a Cache-Control header it guessed from Last-Modified and could keep showing the old Web UI.
  app.use('/*', async (c, next) => {
    await next();
    if (c.res.headers.get('content-type')?.startsWith('text/html')) c.res.headers.set('Cache-Control', 'no-cache');
  });
  app.use('/*', serveStatic({ root: paths.webDist }));
  app.get('*', (c) => c.html(readFileSync(`${paths.webDist}/index.html`, 'utf8')));
}
