// /api/setup: the user config behind onboarding and Settings, on web and Mac. `npm run setup`
// (apps/server/scripts/setup.ts) writes the same file from a terminal.
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { SetupState } from '@omni/shared/settings.ts';
import { getCrew } from './crew.ts';
import { channels, threads } from './db.ts';
import { prepareWorkdir } from './sandbox.ts';
import { addEvent, emitThread } from './runner/state.ts';
import {
  checkSettingFields,
  configPath,
  ensureWorkspace,
  fallbacks,
  isOnboarded,
  omniRepo,
  resolved,
  tildify,
  updateUserConfig,
  userConfig,
  userConfigPatch,
} from './user-config.ts';

export const setupApi = new Hono();

/** The saved values (empty strings mean "use the default"), plus what each default resolves to on this machine. */
export function setupState(): SetupState {
  return {
    onboarded: isOnboarded(),
    path: tildify(configPath()),
    config: userConfig(),
    resolved: {
      timezone: resolved.timezone(),
      workspaceRoot: tildify(resolved.workspaceRoot()),
      reposDir: tildify(resolved.reposDir()),
      centralBrainDir: tildify(resolved.centralBrainDir()),
      hermesUrl: resolved.hermesUrl(),
    },
    fallbacks: { ...fallbacks(), workspaceRoot: tildify(fallbacks().workspaceRoot), reposDir: tildify(fallbacks().reposDir), home: '~' },
    omniRepo: omniRepo(),
  };
}

// Automation overrides change through POST /api/automations/:id/enabled, not here. Each text field is checked by
// checkSettingFields, as @omni/shared/settings.ts says.
const patchInput = userConfigPatch.omit({ automations: true, onboardedAt: true }).superRefine((p, ctx) => {
  checkSettingFields(p, ctx);
  const device = p.runOn?.device;
  if (device && !/^[A-Za-z0-9-]{1,100}$/.test(device)) ctx.addIssue({ code: 'custom', path: ['runOn', 'device'], message: 'Pick a synced machine, or this one.' });
});

setupApi.get('/', (c) => c.json(setupState()));

// JSON only, as links-api.ts: a page in a browser cannot send that cross-origin without a preflight, so it cannot
// point the Hermes URL (and with it the secret store token) or the workspace somewhere else.
setupApi.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && !/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'send JSON' }, 415);
  await next();
});

setupApi.put('/', async (c) => {
  const parsed = patchInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, 400);
  updateUserConfig({ ...parsed.data, onboardedAt: undefined });
  return c.json(setupState());
});

/**
 * Finish onboarding: save what the last screen sent, make the workspace folder, and on the first run only, leave a
 * welcome message in a new #conductor thread. Running setup again from Settings ends here too, without a second welcome.
 */
setupApi.post('/complete', async (c) => {
  const parsed = patchInput.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, 400);
  const first = !isOnboarded();
  updateUserConfig({ ...parsed.data, onboardedAt: new Date().toISOString() });
  ensureWorkspace();
  const thread = first ? await welcomeThread() : null;
  return c.json({ ...setupState(), threadId: thread?.id ?? null });
});

export function welcomeText(name: string) {
  return [
    `Welcome to Omni${name ? `, ${name}` : ''}. I'm the Conductor: tell me what you need and I hand it to the right crew role in the right channel, then report back here.`,
    '',
    'A few things to try:',
    '- Ask for something in plain words, like "research how other stores do size guides" or "fix the failing test in my repo channel".',
    '- Add a channel per client or project from the sidebar (+). A channel with a repo gives every thread its own git worktree.',
    '- Settings holds your name, timezone, folders and integrations. You can run setup again from there.',
    '- Crew charters live in `crew/`; to change one just for you, copy it into `data/crew/` and edit that copy.',
  ].join('\n');
}

/** A conductor thread holding one message from Omni. No agent runs until the user replies. */
async function welcomeThread() {
  if (!channels.get('conductor')) return null;
  const role = getCrew('conductor');
  const id = randomUUID();
  const wd = await prepareWorkdir(channels.get('conductor')!, id);
  const t = threads.create({
    id,
    channel_id: 'conductor',
    title: 'Welcome to Omni',
    status: 'done',
    role: role?.id ?? null,
    model: role?.model ?? null,
    session_id: id,
    cwd: wd.cwd,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  });
  addEvent(t.id, 'assistant_text', { text: welcomeText(resolved.name()) });
  emitThread(t.id);
  return t;
}
