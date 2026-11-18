// /api/setup: the user config behind onboarding and Settings in the Web UI. `npm run setup`
// (apps/server/scripts/setup.ts) writes the same file from a terminal.
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ServerOptionsState, SetupState } from '@omni/shared/settings.ts';
import { BUNDLED, paths } from './config.ts';
import { serverOptions } from './server-options.ts';
import { getCrew } from './crew.ts';
import { cancelGithubLogin, GhLoginError, githubAuth, pollGithubLogin, startGithubLogin } from './github-auth.ts';
import { channels, threads } from './db.ts';
import { prepareWorkdir } from './sandbox.ts';
import { addEvent, emitThread } from './runner/state.ts';
import {
  checkSettingFields,
  configPath,
  ensureWorkspace,
  envOverrides,
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
    install: BUNDLED ? 'app' : 'checkout',
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
    env: envOverrides(),
  };
}

// Automation overrides change through POST /api/automations/:id/enabled, not here. Each text field is checked by
// checkSettingFields, as @omni/shared/settings.ts says.
const patchInput = userConfigPatch.omit({ automations: true, crew: true, onboardedAt: true }).superRefine((p, ctx) => {
  checkSettingFields(p, ctx);
  const device = p.runOn?.device;
  if (device && !/^[A-Za-z0-9-]{1,100}$/.test(device)) ctx.addIssue({ code: 'custom', path: ['runOn', 'device'], message: 'Pick a synced machine, or this one.' });
});

setupApi.get('/', (c) => c.json(setupState()));

// The .env options Settings shows read-only beside the config, each with where its value came from.
setupApi.get('/server', (c) => c.json({ options: serverOptions() } satisfies ServerOptionsState));

// Whether gh is installed and signed in: the PR steps, PR alerts and crew PR review all run it (github-auth.ts).
setupApi.get('/github', async (c) => c.json(await githubAuth()));

// JSON only, as links-api.ts: a page in a browser cannot send that cross-origin without a preflight, so it cannot
// point the Hermes URL (and with it the secret store token) or the workspace somewhere else.
setupApi.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && !/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'send JSON' }, 415);
  await next();
});

// Connect GitHub on the Harnesses step: gh's own web sign-in on this machine (github-auth.ts). Start answers the
// one-time code, the page polls until gh has finished, and Cancel stops gh. The token stays with gh.
const LoginBody = z.object({ flow: z.string().min(1).max(100), secret: z.string().min(1).max(200) });

function loginError(c: Context, err: unknown) {
  if (err instanceof GhLoginError) return c.json({ error: err.message }, err.status);
  throw err;
}

setupApi.post('/github/login', async (c) => {
  try {
    return c.json(await startGithubLogin());
  } catch (err) {
    return loginError(c, err);
  }
});

setupApi.post('/github/login/poll', async (c) => {
  const body = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send {flow, secret}' }, 400);
  try {
    return c.json(pollGithubLogin(body.data.flow, body.data.secret));
  } catch (err) {
    return loginError(c, err);
  }
});

setupApi.post('/github/login/cancel', async (c) => {
  const body = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send {flow, secret}' }, 400);
  try {
    cancelGithubLogin(body.data.flow, body.data.secret);
    return c.json({ ok: true });
  } catch (err) {
    return loginError(c, err);
  }
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

/** Where crew charters live on this install, for the welcome message. */
export interface CrewPlace {
  install: SetupState['install'];
  /** The shipped charters: the checkout's crew/, or a folder inside the desktop app. */
  crew: string;
  /** The user's own copies, which replace a shipped charter with the same name. */
  personalCrew: string;
}

export const crewPlace = (): CrewPlace => ({ install: BUNDLED ? 'app' : 'checkout', crew: tildify(paths.crew), personalCrew: tildify(paths.personalCrew) });

/** The first message in #conductor. Every client shows it, so it names where things are on each layout. */
export function welcomeText(name: string, place: CrewPlace = crewPlace()) {
  const crew =
    place.install === 'app'
      ? `- Crew charters (the roles I hand work to) ship with the app. To change one just for you, save a copy with the same name, like \`builder.md\`, in \`${place.personalCrew}/\`. Settings > About shows where Omni keeps its files.`
      : `- Crew charters live in \`${place.crew}/\`. To change one just for you, copy it into \`${place.personalCrew}/\` and edit that copy.`;
  return [
    `Welcome to Omni${name ? `, ${name}` : ''}. I'm the Conductor: tell me what you need and I hand it to the right crew role in the right channel, then report back here.`,
    '',
    'A few things to try:',
    '- Ask in plain words and say what done looks like, like "research how other stores do size guides and send me a table of 5 stores with links" or "fix the failing test in my repo channel and open a PR". If I can\'t tell what done looks like, I\'ll ask you a few questions first.',
    '- The Inbox lists what needs you, what is working and what finished. Open it with the Inbox disc on the channel rail or by pressing I, or from Activity on a phone. Mark a thread done once you have dealt with it (E on a keyboard).',
    '- When a crew thread I started has a question for you, it shows up in the Conductor thread you asked me in. Answer it there; you don\'t need to open the crew thread.',
    '- #inbox is a channel for quick asks that belong to no client or project.',
    '- Add a channel per client or project: Add channel (+) at the foot of the channel rail, or Settings > Channels on a phone. A channel with a repo gives every thread its own git worktree.',
    '- Settings holds your name, timezone, folders and integrations. You can run setup again from there.',
    crew,
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
