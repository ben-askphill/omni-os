import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Onboarding through /api/setup, the legacy migration that keeps a pre-config install as it was, and the
// personal overrides (data/crew, data/automations, automation toggles) that keep a fork's repo files untouched.

const home = mkdtempSync(join(tmpdir(), 'omni-home-'));
const r = await startRunner({ HOME: home, OMNI_TZ: '' });
delete process.env.OMNI_TZ;
const { app } = await import('../app.ts');
const { configPath, userConfig, resolved, updateUserConfig } = await import('../user-config.ts');
const { legacyConfig, migrateLegacyConfig } = await import('../config-migrate.ts');
const { listCrew } = await import('../crew.ts');
const { loadAutomations } = await import('../automations.ts');
const { paths } = await import('../config.ts');
const { configureGithubAuth } = await import('../github-auth.ts');

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

describe('onboarding', () => {
  it('a fresh data dir has no config and asks for onboarding', async () => {
    expect(existsSync(configPath())).toBe(false);
    const s = await json(await send('GET', '/api/setup'));
    expect(s.onboarded).toBe(false);
    // Tests run the TypeScript, as a checkout does; the desktop app's bundle says 'app' (bundle-boot.test.ts).
    expect(s.install).toBe('checkout');
    expect(s.config.user.name).toBe('');
    expect(s.fallbacks.workspaceRoot).toBe('~/Omni');
    // No threads yet, so the legacy migration leaves it to onboarding.
    expect(migrateLegacyConfig()).toBe(false);
  });

  it('saving a step is not finishing onboarding, and bad values are refused', async () => {
    const s = await json(await send('PUT', '/api/setup', { user: { name: 'Ada', timezone: 'Europe/London' }, workspace: { githubOwner: 'ada' } }));
    expect(s.onboarded).toBe(false);
    expect(s.config.user.name).toBe('Ada');
    expect(s.resolved.timezone).toBe('Europe/London');
    expect((await send('PUT', '/api/setup', { user: { timezone: 'Nowhere/Land' } })).status).toBe(400);
    expect((await send('PUT', '/api/setup', { workspace: { githubOwner: 'not an owner' } })).status).toBe(400);
    expect((await send('PUT', '/api/setup', { integrations: { hermesUrl: 'ftp://x' } })).status).toBe(400);
    expect((await send('PUT', '/api/setup', { workspace: { root: '~/x\nrm -rf ~' } })).status).toBe(400);
    // A form post from another page cannot change it.
    const form = await app.request('/api/setup', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{"integrations":{"hermesUrl":"http://evil"}}' });
    expect(form.status).toBe(415);
    // Automation overrides go through their own endpoint.
    await send('PUT', '/api/setup', { automations: { 'weekly-review': { enabled: true } } });
    expect(userConfig().automations['weekly-review']).toBeUndefined();
  });

  it("saving one field, as Settings' Reset does, keeps the section's other fields", async () => {
    await send('PUT', '/api/setup', { user: { name: 'Ada', timezone: 'Europe/London', email: 'ada@example.com' }, workspace: { githubOwner: 'ada' } });
    const s = await json(await send('PUT', '/api/setup', { user: { email: '' } }));
    expect(s.config.user).toMatchObject({ name: 'Ada', timezone: 'Europe/London', email: '' });
    expect(s.config.workspace.githubOwner).toBe('ada');
  });

  it('saving Integrations keeps the integrations fields Sharing & access shows read-only', async () => {
    updateUserConfig({ integrations: { tailscaleLogin: 'ada@example.com' } });
    const s = await json(await send('PUT', '/api/setup', { integrations: { hermesUrl: '', centralBrainDir: '' } }));
    expect(s.config.integrations.tailscaleLogin).toBe('ada@example.com');
  });

  it('complete marks it done, makes the workspace and leaves one welcome thread in #conductor', async () => {
    const ws = join(home, 'Work');
    const done = await json(await send('POST', '/api/setup/complete', { workspace: { root: ws } }));
    expect(done.onboarded).toBe(true);
    expect(done.config.workspace.root).toBe(ws);
    expect(done.threadId).toBeTruthy();
    const t = r.db.threads.get(done.threadId)!;
    expect(t.channel_id).toBe('conductor');
    const evs = r.events(done.threadId);
    expect(evs.map((e) => e.kind)).toEqual(['assistant_text']);
    expect(evs[0].p.text).toContain('Welcome to Omni, Ada');
    // This checkout's own crew folders, not the desktop app's wording.
    expect(evs[0].p.text).toContain(`- Crew charters live in \`${paths.crew}/\`. To change one just for you, copy it into \`${paths.personalCrew}/\``);
    expect((await json(await send('GET', '/api/status'))).profile.onboarded).toBe(true);
    // Running setup again from Settings: no second welcome.
    expect((await json(await send('POST', '/api/setup/complete', {}))).threadId).toBeNull();
  });
});

describe('the welcome message', () => {
  const lines = (text: string) => text.split('\n');

  it('in a checkout, names the repo crew folder and the data/crew copy', async () => {
    const { welcomeText } = await import('../setup-api.ts');
    const text = welcomeText('Ada', { install: 'checkout', crew: '~/omni-os/crew', personalCrew: '~/omni-os/data/crew' });
    expect(lines(text)).toContain('- Crew charters live in `~/omni-os/crew/`. To change one just for you, copy it into `~/omni-os/data/crew/` and edit that copy.');
  });

  it('in the desktop app, names the data folder the app reads and Settings > About, never a crew/ folder to edit', async () => {
    const { welcomeText } = await import('../setup-api.ts');
    const personal = '~/Library/Application Support/Omni/data/crew';
    const text = welcomeText('Ada', { install: 'app', crew: '/Applications/Omni.app/Contents/Resources/app/crew', personalCrew: personal });
    const crew = lines(text).find((l) => l.startsWith('- Crew charters'))!;
    expect(crew).toBe(
      `- Crew charters (the roles I hand work to) ship with the app. To change one just for you, save a copy with the same name, like \`builder.md\`, in \`${personal}/\`. Settings > About shows where Omni keeps its files.`,
    );
    expect(text).not.toContain('Resources/app/crew');
    expect(text).not.toMatch(/`crew\/`|`data\/crew\/`/);
  });

  it('says where to add a channel on the rail and on a phone, not "the sidebar"', async () => {
    const { welcomeText } = await import('../setup-api.ts');
    for (const install of ['app', 'checkout'] as const) {
      const text = welcomeText('', { install, crew: '~/c', personalCrew: '~/d' });
      expect(text).toContain('Add channel (+) at the foot of the channel rail, or Settings > Channels on a phone.');
      expect(text).not.toContain('sidebar');
    }
  });

  it('explains the Inbox, crew questions and the General channel, on every layout', async () => {
    const { welcomeText } = await import('../setup-api.ts');
    const text = welcomeText('', { install: 'app', crew: '~/c', personalCrew: '~/d' });
    expect(text).toContain('The Inbox lists what needs you, what is working and what finished.');
    expect(text).toContain('the Inbox disc on the channel rail or by pressing I, or from Activity on a phone');
    expect(text).toContain('Mark a thread done');
    expect(text).toContain('When a crew thread I started has a question for you, it shows up in the Conductor thread you asked me in.');
    expect(text).toContain('For a quick question, start a thread in #General: it answers there');
  });

  it('gives an example with a finish line, and says the Conductor asks when there is none (#725 briefs)', async () => {
    const { welcomeText } = await import('../setup-api.ts');
    const text = welcomeText('', { install: 'checkout', crew: '~/c', personalCrew: '~/d' });
    expect(text).toContain('say what done looks like');
    expect(text).toContain('"find three venues for a team day in May under 2,000 euros and send me a table with links"');
    expect(text).toContain("If I can't tell what done looks like, I'll ask you a few questions first.");
  });
});

describe('GET /api/setup/github', () => {
  const bin = join(home, 'fake-gh');
  const fakeGh = (out: string, code: number, stream: 'stdout' | 'stderr' = code ? 'stderr' : 'stdout') =>
    writeFileSync(bin, `#!/bin/sh\ncat >&${stream === 'stdout' ? 1 : 2} <<'OUT'\n${out}\nOUT\nexit ${code}\n`, { mode: 0o755 });

  it('signed in: ready, with the active account login and nothing from the token line', async () => {
    fakeGh(
      [
        'github.com',
        '  ✓ Logged in to github.com account old-me (keyring)',
        '  - Active account: false',
        '  ✓ Logged in to github.com account ada-l (keyring)',
        '  - Active account: true',
        '  - Token: gho_************************************',
      ].join('\n'),
      0,
    );
    configureGithubAuth({ bin, platform: 'darwin' });
    const body = await json(await send('GET', '/api/setup/github'));
    expect(body).toEqual({ state: 'ready', login: 'ada-l' });
  });

  it('signed out: gh auth login to run', async () => {
    fakeGh('You are not logged into any GitHub hosts. To log in, run: gh auth login', 1);
    configureGithubAuth({ bin, platform: 'darwin' });
    expect(await json(await send('GET', '/api/setup/github'))).toEqual({ state: 'signed-out', command: 'gh auth login' });
  });

  it('no gh: brew on a Mac, cli.github.com elsewhere', async () => {
    configureGithubAuth({ bin: join(home, 'no-such-gh'), platform: 'darwin' });
    expect(await json(await send('GET', '/api/setup/github'))).toEqual({ state: 'missing', install: 'brew install gh', command: 'gh auth login' });
    configureGithubAuth({ platform: 'linux' });
    const linux = await json(await send('GET', '/api/setup/github'));
    expect(linux.state).toBe('missing');
    expect(linux.install).toBeUndefined();
    expect(linux.reason).toContain('cli.github.com');
  });

  it('anything else: a sentence, nothing to copy', async () => {
    fakeGh('error connecting to api.github.com', 1);
    configureGithubAuth({ bin, platform: 'darwin' });
    const body = await json(await send('GET', '/api/setup/github'));
    expect(body.state).toBe('error');
    expect(body.command).toBeUndefined();
    expect(body.reason).toMatch(/\.$/);
  });
});

describe('Connect GitHub: gh auth login --web', () => {
  // A gh that signs in the way the real one does without a terminal: the code and page on stderr, then a wait until
  // the test writes what the person did on GitHub into `answer`. `auth status` reads whether it signed in.
  const dir = join(home, 'gh-login');
  const bin = join(dir, 'gh');
  const answer = (what: 'ok' | 'deny' | 'expire') => writeFileSync(join(dir, 'answer'), what);
  const fakeLogin = (login = "printf '\\n! First copy your one-time code: AB12-CD34\\nOpen this URL to continue in your web browser: https://github.com/login/device\\n' >&2") => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      bin,
      [
        '#!/bin/sh',
        'd=$(dirname "$0")',
        'if [ "$1 $2" = "auth status" ]; then',
        '  if [ -f "$d/signed-in" ]; then printf "github.com\\n  ✓ Logged in to github.com account ada-l (keyring)\\n  - Active account: true\\n"; exit 0; fi',
        '  echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1',
        'fi',
        'echo "$*" > "$d/args"',
        login,
        'while [ ! -f "$d/answer" ]; do sleep 0.02; done',
        'case "$(cat "$d/answer")" in',
        '  ok) touch "$d/signed-in"; printf "✓ Authentication complete.\\n✓ Logged in as ada-l\\n" >&2; exit 0;;',
        '  deny) echo "failed to authenticate via web browser: access_denied" >&2; exit 1;;',
        '  expire) echo "failed to authenticate via web browser: authentication timed out" >&2; exit 1;;',
        'esac',
      ].join('\n'),
      { mode: 0o755 },
    );
    configureGithubAuth({ bin, platform: 'darwin', startMs: 5_000 });
  };
  /** Polls the way the page does until the sign-in is no longer pending. */
  const settle = async (flow: { flow: string; secret: string }) => {
    for (let i = 0; i < 200; i++) {
      const r = await json(await send('POST', '/api/setup/github/login/poll', { flow: flow.flow, secret: flow.secret }));
      if (r.state !== 'pending') return r;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    throw new Error('still pending');
  };

  it('answers the code and the page, then signed in with the login gh auth status reads', async () => {
    fakeLogin();
    const res = await send('POST', '/api/setup/github/login', {});
    expect(res.status).toBe(200);
    const flow = await json(res);
    expect(flow).toMatchObject({ userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device', verificationUriComplete: null, interval: 2 });
    expect(readFileSync(join(dir, 'args'), 'utf8').trim()).toBe('auth login --web --hostname github.com');
    expect(await json(await send('POST', '/api/setup/github/login/poll', { flow: flow.flow, secret: flow.secret }))).toEqual({ state: 'pending' });
    answer('ok');
    expect(await settle(flow)).toEqual({ state: 'signed_in', login: 'ada-l' });
    expect(await json(await send('GET', '/api/setup/github'))).toEqual({ state: 'ready', login: 'ada-l' });
  });

  it('declined on GitHub, or the code expired', async () => {
    fakeLogin();
    let flow = await json(await send('POST', '/api/setup/github/login', {}));
    answer('deny');
    expect(await settle(flow)).toEqual({ state: 'denied' });
    fakeLogin();
    flow = await json(await send('POST', '/api/setup/github/login', {}));
    answer('expire');
    expect(await settle(flow)).toEqual({ state: 'expired' });
  });

  it('Cancel stops gh, so a code entered afterwards signs nothing in', async () => {
    fakeLogin();
    const flow = await json(await send('POST', '/api/setup/github/login', {}));
    expect((await send('POST', '/api/setup/github/login/cancel', { flow: flow.flow, secret: flow.secret })).status).toBe(200);
    expect(await settle(flow)).toEqual({ state: 'refused', error: 'Cancelled.' });
    await new Promise((ok) => setTimeout(ok, 100));
    answer('ok');
    await new Promise((ok) => setTimeout(ok, 150));
    expect(existsSync(join(dir, 'signed-in'))).toBe(false);
  });

  it('only the page holding the secret polls or cancels, and a second Connect replaces the first', async () => {
    fakeLogin();
    const first = await json(await send('POST', '/api/setup/github/login', {}));
    expect((await send('POST', '/api/setup/github/login/poll', { flow: first.flow, secret: 'nope' })).status).toBe(404);
    expect((await send('POST', '/api/setup/github/login/cancel', { flow: first.flow, secret: 'nope' })).status).toBe(404);
    expect((await send('POST', '/api/setup/github/login/poll', {})).status).toBe(400);
    const second = await json(await send('POST', '/api/setup/github/login', {}));
    expect(second.flow).not.toBe(first.flow);
    const stale = await send('POST', '/api/setup/github/login/poll', { flow: first.flow, secret: first.secret });
    expect(stale.status).toBe(404);
    expect((await json(stale)).error).toBe('No such sign-in. Start again.');
    await send('POST', '/api/setup/github/login/cancel', { flow: second.flow, secret: second.secret });
  });

  it('gh refusing before a code, a gh that prints none, and no gh: an error in words', async () => {
    fakeLogin("echo 'The value of the GH_TOKEN environment variable is being used for authentication.' >&2; exit 1");
    let res = await send('POST', '/api/setup/github/login', {});
    expect(res.status).toBe(502);
    expect((await json(res)).error).toBe('The value of the GH_TOKEN environment variable is being used for authentication.');

    fakeLogin('sleep 5');
    configureGithubAuth({ startMs: 200 });
    res = await send('POST', '/api/setup/github/login', {});
    expect(res.status).toBe(502);
    expect((await json(res)).error).toContain('gh gave no sign-in code');

    configureGithubAuth({ bin: join(dir, 'no-such-gh') });
    res = await send('POST', '/api/setup/github/login', {});
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe('The GitHub CLI is not installed on the machine Omni runs on.');
  });
});

describe('where a setting comes from', () => {
  it('names the env var that overrides a field: || ones only when set, ?? ones even empty', async () => {
    const keep = { tz: process.env.OMNI_TZ, hermes: process.env.OMNI_HERMES_URL, brain: process.env.OMNI_BRAIN_DIR };
    try {
      process.env.OMNI_TZ = '';
      process.env.OMNI_HERMES_URL = '';
      delete process.env.OMNI_BRAIN_DIR;
      let env = (await json(await send('GET', '/api/setup'))).env;
      expect(env['user.timezone']).toBeUndefined();
      expect(env['integrations.hermesUrl']).toBe('OMNI_HERMES_URL');
      process.env.OMNI_TZ = 'Asia/Tokyo';
      process.env.OMNI_BRAIN_DIR = '/tmp/brain';
      env = (await json(await send('GET', '/api/setup'))).env;
      expect(env).toMatchObject({ 'user.timezone': 'OMNI_TZ', 'workspace.root': 'OMNI_BRAIN_DIR' });
    } finally {
      for (const [k, v] of [['OMNI_TZ', keep.tz], ['OMNI_HERMES_URL', keep.hermes], ['OMNI_BRAIN_DIR', keep.brain]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('lists the .env options with their value and source, and nothing secret', async () => {
    const { options } = await json(await send('GET', '/api/setup/server'));
    const keepalive = options.find((o: { env: string }) => o.env === 'OMNI_KEEPALIVE_SECONDS');
    expect(keepalive).toMatchObject({ section: 'threads', default: '600 s' });
    expect(['env', 'default']).toContain(keepalive.source);
    for (const o of options) expect(o.env).not.toMatch(/KEY|TOKEN|SECRET|AUTH|WEBHOOK/);
    const { serverOptions } = await import('../server-options.ts');
    expect(serverOptions({ OMNI_PORT: '4799' }).find((o) => o.env === 'OMNI_PORT')?.source).toBe('env');
    expect(serverOptions({}).every((o) => o.source === 'default')).toBe(true);
  });
});

describe('personal overrides', () => {
  it('a charter in data/crew replaces the shared one and placeholders are filled', () => {
    mkdirSync(paths.personalCrew, { recursive: true });
    writeFileSync(join(paths.personalCrew, 'inbox.md'), '---\nname: My inbox\n---\nWork for {{user}} in {{workspace}}.');
    const inbox = listCrew().find((c) => c.id === 'inbox')!;
    expect(inbox.name).toBe('My inbox');
    expect(inbox.charter).toBe(`Work for Ada in ${resolved.workspaceRoot().replace(home, '~')}.`);
    rmSync(join(paths.personalCrew, 'inbox.md'));
    expect(listCrew().find((c) => c.id === 'inbox')!.charter).not.toMatch(/\{\{|phillbert/);
  });

  // Omni ships no automations, so the first run lists none. apps/desktop/tests/stage.test.ts guards the app's copy.
  it('a fresh data dir lists no automations', async () => {
    expect(loadAutomations()).toEqual([]);
    expect(await json(await send('GET', '/api/automations'))).toEqual([]);
  });

  it('an automation in data/automations loads with your placeholders and timezone', () => {
    mkdirSync(paths.personalAutomations, { recursive: true });
    writeFileSync(join(paths.personalAutomations, 'digest.yaml'), 'name: Mine\ncron: "0 9 * * 1"\nchannel: inbox\nprompt: hi {{user}}\n');
    const a = loadAutomations().find((x) => x.id === 'digest')!;
    expect(a.name).toBe('Mine');
    expect(a.prompt).toBe('hi Ada');
    // No timezone in the YAML: the user's.
    expect(a.timezone).toBe('Europe/London');
    rmSync(join(paths.personalAutomations, 'digest.yaml'));
  });

  it('the shared charters name nobody', () => {
    for (const c of listCrew()) expect(c.charter).not.toMatch(/phillbert|firstmate|\bBen\b|\{\{/);
  });
});

describe('legacy migration', () => {
  it("an install from before the config keeps the old defaults: workspace ~/phillbert, Amsterdam, its name", async () => {
    rmSync(configPath());
    mkdirSync(join(home, 'phillbert'), { recursive: true });
    mkdirSync(join(home, 'central-brain'), { recursive: true });
    r.db.kv.set('profile', { name: 'Ben' });
    const brain = process.env.OMNI_BRAIN_DIR;
    delete process.env.OMNI_BRAIN_DIR;
    try {
      const c = legacyConfig();
      expect(c.user.name).toBe('Ben');
      expect(c.user.timezone).toBe('Europe/Amsterdam');
      expect(c.workspace.root).toBe('~/phillbert');
      expect(c.integrations.centralBrainDir).toBe('~/central-brain');
      expect(c.onboardedAt).toBeTruthy();
      // The data dir has threads (the welcome one), so boot writes it and skips onboarding.
      expect(migrateLegacyConfig()).toBe(true);
      expect(resolved.workspaceRoot()).toBe(join(home, 'phillbert'));
      expect(resolved.timezone()).toBe('Europe/Amsterdam');
      expect((await json(await send('GET', '/api/setup'))).onboarded).toBe(true);
      // Only once.
      expect(migrateLegacyConfig()).toBe(false);
    } finally {
      process.env.OMNI_BRAIN_DIR = brain;
    }
  });
});

describe('the first run for someone new', () => {
  it('seeds General, not a second Inbox, for quick asks', () => {
    expect(r.db.channels.get('inbox')).toMatchObject({ name: 'General', kind: 'internal', use_worktree: 0 });
  });

  it('keeps what you do and the tools you use, and tells every agent', async () => {
    const s = await json(await send('PUT', '/api/setup', { user: { name: 'Ada', work: 'I run a small design studio', tools: 'Email, Calendar, Notion' } }));
    expect(s.config.user).toMatchObject({ work: 'I run a small design studio', tools: 'Email, Calendar, Notion' });
    expect((await send('PUT', '/api/setup', { user: { work: 'x'.repeat(301) } })).status).toBe(400);
    const { buildSystemPrompt } = await import('../runner/prompts.ts');
    const prompt = buildSystemPrompt(r.db.threads.list({})[0], r.db.channels.get('inbox')!);
    expect(prompt).toContain('- What Ada does: I run a small design studio');
    expect(prompt).toContain('- Tools Ada uses: Email, Calendar, Notion. Reach for these first when they are connected.');
  });

  it('makes the starter routines turned on, each on, in General, as Admin, with its quiet and approval settings', async () => {
    const done = await json(await send('POST', '/api/setup/complete', { starters: ['morning-plan', 'follow-ups'] }));
    expect(done.starters).toEqual(['morning-plan', 'follow-ups']);
    const a = loadAutomations().filter((x) => x.id === 'morning-plan' || x.id === 'follow-ups' || x.id === 'weekly-review');
    expect(a.map((x) => [x.id, x.enabled, x.channel, x.role, x.cron, !!x.quiet, !!x.approve, x.expiresAfter ?? null])).toEqual([
      ['follow-ups', true, 'inbox', 'inbox', '0 10 * * 1-5', true, true, 28_800],
      ['morning-plan', true, 'inbox', 'inbox', '30 8 * * 1-5', true, false, null],
    ]);
    // Again: they exist, so nothing new. An unknown id is refused.
    expect((await json(await send('POST', '/api/setup/complete', { starters: ['morning-plan'] }))).starters).toEqual([]);
    expect((await send('POST', '/api/setup/complete', { starters: ['mine'] })).status).toBe(400);
    for (const id of ['morning-plan', 'follow-ups']) rmSync(join(paths.personalAutomations, `${id}.yaml`));
  });

  it('runs the first question in General with no charter, and no question starts no thread', async () => {
    const done = await json(await send('POST', '/api/setup/complete', { ask: 'What is a good name for a bakery?' }));
    const t = r.db.threads.get(done.threadId)!;
    expect(t).toMatchObject({ channel_id: 'inbox', role: null, branch: null, source: 'manual' });
    await r.untilResults(t.id, 1);
    expect(r.events(t.id).find((e) => e.kind === 'user')?.p.text).toBe('What is a good name for a bakery?');
    const again = await json(await send('POST', '/api/setup/complete', {}));
    expect(again.threadId).toBeNull();
    expect((await send('POST', '/api/setup/complete', { ask: 7 })).status).toBe(400);
  });
});
