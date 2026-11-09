// /api/claude-artifacts: Ben's claude.ai Artifacts as the last good listing left them, a refresh, and its schedule.
import { Hono } from 'hono';
import { isSchedule } from '@omni/shared/claude-artifacts.ts';
import { claudeArtifactsResponse, claudeArtifactsState, refreshClaudeArtifacts, setClaudeArtifactsSchedule } from './claude-artifacts.ts';

export const claudeArtifactsApi = new Hono();

claudeArtifactsApi.get('/', (c) => c.json(claudeArtifactsResponse()));

/**
 * Start a refresh. `force`: run even when the last attempt is under ten minutes old (the Refresh button; opening the
 * screen sends none). `wait`: answer with the list once the run ends (the Conductor); otherwise 202 with the state.
 */
claudeArtifactsApi.post('/refresh', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { force?: unknown; wait?: unknown };
  const run = refreshClaudeArtifacts({ force: body.force === true });
  if (body.wait === true) {
    await run;
    return c.json(claudeArtifactsResponse());
  }
  return c.json({ state: claudeArtifactsState() }, 202);
});

claudeArtifactsApi.put('/schedule', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { schedule?: unknown };
  if (!isSchedule(body.schedule)) return c.json({ error: 'schedule must be off, 6h or daily' }, 400);
  setClaudeArtifactsSchedule(body.schedule);
  return c.json({ state: claudeArtifactsState() });
});
