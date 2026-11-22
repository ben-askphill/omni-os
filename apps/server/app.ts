import { Hono } from 'hono';
import { getPath } from 'hono/utils/url';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { paths } from './config.ts';
// The runner's ports are bound before any route can reach it (apps/server/compose.ts).
import './compose.ts';
import { accountsApi } from './accounts-api.ts';
import { artifactsApi } from './artifacts-api.ts';
import { claudeArtifactsApi } from './claude-artifacts-api.ts';
import { authApi } from './auth-api.ts';
import { capabilitiesApi } from './capabilities-api.ts';
import { browserApi } from './browser-api.ts';
import { changesApi } from './changes-api.ts';
import { reviewNotesApi } from './review-notes-api.ts';
import { askApi } from './ask-api.ts';
import { membersApi } from './members-api.ts';
import { continueApi } from './continue-api.ts';
import { transitionsApi } from './transitions-api.ts';
import { channelsApi } from './channels-api.ts';
import { actionsApi } from './actions-api.ts';
import { foldersApi } from './folders-api.ts';
import { commandsApi } from './commands-api.ts';
import { skillsApi } from './skills-api.ts';
import { templatesApi } from './templates-api.ts';
import { crewMemoryApi, memoryApi } from './memory-api.ts';
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
import { mcpClientsApi } from './mcp-clients.ts';
import { oauthMetadataApi } from './mcp-oauth.ts';
import { metaApi } from './meta-api.ts';
import { crewApi } from './crew-api.ts';
import { customHarnessApi } from './custom-harness-api.ts';
import { remoteLeadApi } from './remote-lead-api.ts';
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
import { cspReportApi } from './csp-report-api.ts';
import { analyticsApi } from './analytics-api.ts';
import { captureException } from './analytics.ts';
import { connectHostname } from './connect/service.ts';
import { requestGuard, useConnectHost, useLegacyUpgrade, useSessionCheck, useThreadTokenCheck } from './request-guard.ts';
import { threadOfToken } from './thread-tokens.ts';
import { newCookiePath, setSessionCookie, withoutKey } from './browser-session.ts';
import { browserName, createSession, sessionById, sessionFor, setCookiePath } from './google-auth.ts';
import { toolFailuresApi } from './tool-failures-api.ts';
import { worktreesApi } from './worktrees-api.ts';
import { updateApi } from './update-api.ts';
import { usageScanApi } from './usage-scan/api.ts';
import { webShell } from './web-headers.ts';

// Every /api route, and the Web UI. apps/server/index.ts boots it. A browser on plain HTTP sends its requests under
// /api/k/<key>, its cookie's own path (browser-session.ts); the routes see them without the key.
export const app = new Hono({ getPath: (req) => withoutKey(getPath(req)) });
const api = new Hono();

app.onError((err, c) => {
  console.error('[api]', err);
  const status = err instanceof z.ZodError ? 400 : ((err as { status?: number }).status ?? 500);
  // A 500 is a bug: its class and frames go to PostHog when usage analytics is on (analytics.ts), never its message.
  if (status >= 500) captureException(err, { where: c.req.routePath });
  // A refusal with more to say than its message (sync/guard.ts livesOnRefusal): its fields go next to `error`.
  const reply = (err as { reply?: unknown }).reply;
  return c.json({ ...(reply && typeof reply === 'object' ? reply : {}), error: err.message }, status as 400);
});

// Ahead of every route: refuses requests without this install's token, and those other sites make through a browser
// (apps/server/request-guard.ts). The Web UI below is served without either: it holds no secret, and pairs to get one.
useSessionCheck(sessionFor, sessionById);
// A thread's own token (thread-tokens.ts): the request is that thread's.
useThreadTokenCheck(threadOfToken);
// An older build's raw-token cookie, traded once for a session (browser-session.ts).
useLegacyUpgrade((c) => {
  const s = createSession(browserName(c.req.header('user-agent')), 'browser', '', 'token');
  const cookiePath = newCookiePath(c);
  setCookiePath(s.id, cookiePath);
  setSessionCookie(c, s.token, cookiePath);
  return { ...s, cookiePath };
});
useConnectHost(connectHostname);
api.use('*', requestGuard);

// Mounted in the same order the handlers used to be registered. Hono runs the first match, so
// threadsApi and terminalApi stay between the thread reads and the message, upload, stop, and stream routes.
api.route('/auth', authApi);
api.route('/mcp/clients', mcpClientsApi);
api.route('/capabilities', capabilitiesApi);
api.route('/channels', channelsApi);
api.route('/channels', browserApi);
api.route('/', actionsApi);
api.route('/folders', foldersApi);
api.route('/threads', threadRoutesApi);
api.route('/threads', threadsApi);
api.route('/threads', terminalApi);
api.route('/threads', changesApi);
api.route('/threads', reviewNotesApi);
api.route('/threads', askApi);
api.route('/threads', membersApi);
api.route('/threads', remoteLeadApi);
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
api.route('/claude-artifacts', claudeArtifactsApi);
api.route('/', githubApi);
api.route('/', githubWebhookApi);
api.route('/', automationDeliveriesApi);
api.route('/', prWatchApi);
api.route('/', crewApi);
api.route('/', customHarnessApi);
api.route('/', crewMemoryApi);
api.route('/', metaApi);
api.route('/commands', commandsApi);
api.route('/skills', skillsApi);
api.route('/templates', templatesApi);
api.route('/memory', memoryApi);
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
api.route('/accounts', accountsApi);
api.route('/usage-scan', usageScanApi);
api.route('/csp-report', cspReportApi);
api.route('/analytics', analyticsApi);

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
  const index = `${paths.webDist}/index.html`;
  app.use('/*', async (c, next) => {
    await next();
    // /api, /mcp and /.well-known answer above and stop there. Should one ever fall through, it keeps its own
    // headers: an artifact page with this frame-ancestors would no longer load in the Web UI's frames.
    if (/^\/(api|mcp|\.well-known)(\/|$)/.test(c.req.path)) return;
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    if (!c.res.headers.get('content-type')?.startsWith('text/html')) return;
    // index.html names this build's hashed assets, so a browser revalidates it on every load and picks up a rebuild.
    // Without a Cache-Control header it guessed from Last-Modified and could keep showing the old Web UI.
    c.res.headers.set('Cache-Control', 'no-cache');
    // The CSP, clickjacking guard and referrer policy (web-headers.ts), with the hash of the build's inline script.
    for (const [name, value] of Object.entries(webShell(index).headers)) c.res.headers.set(name, value);
  });
  app.use('/*', serveStatic({ root: paths.webDist }));
  app.get('*', (c) => c.html(webShell(index).html));
}
