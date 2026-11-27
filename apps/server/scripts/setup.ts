// `npm run setup`: the onboarding wizard in a terminal. Asks what the Web UI's wizard asks and writes the same
// file (data/omni.config.json, apps/server/user-config.ts). Safe to run again: every answer defaults to what is
// saved, so Enter through it changes nothing.
//
//   npm run setup                    ask each question
//   npm run setup -- --yes           take every default (saved value, else detected), no prompts
//   npm run setup -- --name Ada --email ada@example.com --timezone Europe/London --pronouns she/her \
//     --workspace ~/Omni --repos ~/code --github-owner ada --channel "Acme" --channel-repo ~/code/acme --yes
//
// With the server running (OMNI_URL or :OMNI_PORT) the first channel and the welcome thread go through its API, so
// open clients see them at once. Without it the channel is written to the database directly.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  configPath,
  ensureWorkspace,
  expandHome,
  fallbacks,
  isOnboarded,
  isTimezone,
  omniRepo,
  tildify,
  updateUserConfig,
  userConfig,
  type UserConfigPatch,
} from '../user-config.ts';
import { HARNESS_CHECK_LABEL, harnessAccountLine, harnessCheck } from '@omni/shared/harness-check.ts';
import { githubLine, type GithubCheck } from '@omni/shared/github-check.ts';
import { accountsByHarness, machineAccounts, type AccountsView, type HarnessAccountView } from '@omni/shared/harness-accounts.ts';
import { githubAuth } from '../github-auth.ts';
import { apiToken } from '../api-token.ts';
import { HARNESS_INSTALL, HARNESS_META, type HarnessId } from '../harness/types.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const yes = argv.includes('--yes') || argv.includes('-y');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readHeader());
  process.exit(0);
}

const sh = (cmd: string, args: string[]) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim();
  } catch {
    return '';
  }
};

const rl = yes ? null : createInterface({ input: stdin, output: stdout });

async function ask(label: string, current: string, opts: { flag?: string; check?: (v: string) => string | null } = {}): Promise<string> {
  const given = opts.flag ? flag(opts.flag) : undefined;
  if (given !== undefined || !rl) {
    const v = given ?? current;
    const err = v && opts.check?.(v);
    if (err) throw new Error(`${label}: ${err}`);
    return v;
  }
  for (;;) {
    const answer = (await rl.question(`  ${label}${current ? ` [${current}]` : ''}: `)).trim();
    const v = answer === '-' ? '' : answer || current;
    const err = v && opts.check?.(v);
    if (!err) return v;
    console.log(`    ${err}`);
  }
}

const say = (s = '') => console.log(s);

/** The running server takes only requests with this install's token (apps/server/api-token.ts). */
const authed = (headers: Record<string, string> = {}) => ({ ...headers, authorization: `Bearer ${apiToken()}` });

/**
 * This checkout's running server: its URL when it takes this checkout's token, null when nothing answers. A server
 * that answers but refuses the token belongs to another install, most likely the desktop app on :4747, which keeps its
 * own settings in its own data folder: writing this checkout's file would not set it up, so setup stops there.
 */
async function serverUrl() {
  const url = process.env.OMNI_URL ?? `http://127.0.0.1:${process.env.OMNI_PORT ?? 4747}`;
  let res: Response;
  try {
    res = await fetch(`${url}/api/setup`, { headers: authed(), signal: AbortSignal.timeout(1500) });
  } catch {
    return null;
  }
  if (res.ok) return url;
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      [
        `${url} answers but refuses this checkout's token, so it is another Omni: most likely the desktop app.`,
        "The desktop app keeps its own settings and never reads this checkout's data/. Set it up in the app instead:",
        'Settings > General > Run setup again.',
        "To set up this checkout, quit the app or point OMNI_URL at this checkout's server, then run npm run setup again.",
      ].join('\n'),
    );
  }
  return null;
}

async function main() {
  const cur = userConfig();
  const fb = fallbacks();
  const server = await serverUrl();
  say('');
  say(`Omni setup${isOnboarded() ? ' (already set up: Enter keeps each value, - clears one)' : ''}`);
  say(`Writes ${tildify(configPath())}. Nothing here goes into git.`);
  say('');

  say('1. You');
  const name = await ask('Name Omni and its agents call you', cur.user.name || sh('git', ['config', '--global', 'user.name']).split(/\s+/)[0] || '', { flag: 'name' });
  const email = await ask('Email', cur.user.email || sh('git', ['config', '--global', 'user.email']), {
    flag: 'email',
    check: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'That does not look like an email.'),
  });
  const timezone = await ask('Timezone', cur.user.timezone || fb.timezone, { flag: 'timezone', check: (v) => (isTimezone(v) ? null : 'Unknown timezone, use an IANA name like Europe/Amsterdam.') });
  const pronouns = await ask('Pronouns', cur.user.pronouns || 'they/them', { flag: 'pronouns' });
  const work = await ask('What you do, in a line (optional)', cur.user.work, { flag: 'work' });
  const tools = await ask('Tools you use, comma separated (optional)', cur.user.tools, { flag: 'tools' });
  say('');

  say('2. Workspace');
  say('   Where Omni keeps your files: threads without a repo run there, and its CLAUDE.md and skills load in every Claude thread.');
  const root = await ask('Workspace folder', cur.workspace.root || tildify(fb.workspaceRoot), { flag: 'workspace' });
  const reposDir = await ask('Folder with your git checkouts', cur.workspace.reposDir || tildify(fb.reposDir), { flag: 'repos' });
  const ghLogin = sh('gh', ['api', 'user', '--jq', '.login']);
  const githubOwner = await ask('GitHub owner (user or org)', cur.workspace.githubOwner || ghLogin || omniRepo()?.split('/')[0] || '', {
    flag: 'github-owner',
    check: (v) => (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(v) ? null : 'A GitHub owner is a user or org name, like octocat.'),
  });
  say('');

  const patch: UserConfigPatch = {
    user: { name, email, timezone: timezone === fb.timezone && !cur.user.timezone ? '' : timezone, pronouns: pronouns || 'they/them', work, tools },
    workspace: { root: root === tildify(fb.workspaceRoot) && !cur.workspace.root ? '' : root, reposDir: reposDir === tildify(fb.reposDir) && !cur.workspace.reposDir ? '' : reposDir, githubOwner },
  };

  say('3. Harnesses');
  await harnesses(server);
  say('');

  say('4. First channel (a client or project; Enter to skip)');
  const chName = await ask('Channel name', flag('channel') ?? '', {});
  if (chName) {
    const repo = await ask('Repo folder (optional)', '', { flag: 'channel-repo', check: (v) => (existsSync(expandHome(v)) ? null : `No folder at ${v}.`) });
    const store = await ask('Shopify store domain (optional)', '', { flag: 'channel-store' });
    await createChannel(server, chName, repo, store);
  }
  say('');

  // Saved last, so Ctrl-C halfway leaves the file as it was.
  if (server) {
    const res = await fetch(`${server}/api/setup/complete`, { method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(patch) });
    const body = (await res.json()) as { error?: string; threadId?: string | null };
    if (!res.ok) throw new Error(body.error ?? `server said ${res.status}`);
    if (body.threadId) say(`A welcome message is waiting in #conductor.`);
  } else {
    updateUserConfig({ ...patch, onboardedAt: new Date().toISOString() });
    ensureWorkspace();
  }
  say(`5. Done. Saved ${tildify(configPath())}.`);
  say(server ? `   Open ${server}.` : '   Start Omni with `npm run dev` (web on http://localhost:4748).');
  say("   The desktop app keeps its own settings and asks these questions itself; it does not read this checkout's data/.");
  say('   Change any of this later in Settings, or run `npm run setup` again.');
  say('');
  say('   Next:');
  say('   - Add your iPhone: make a pairing code in Settings > Sharing & access > Omni for iOS.');
  say('   - Run threads on a second machine: turn on Settings > Sync on both, then pick one with Run on.');
  say('   - From this checkout, start a thread or check the install: scripts/omni.sh new "…", scripts/omni.sh doctor.');
}

/** Which CLIs are installed and signed in, from the running server's probe when there is one. */
async function harnesses(server: string | null) {
  type H = { id: string; name: string; available: boolean; fix?: string; install?: string; missing?: boolean };
  let list: H[] | null = null;
  let accounts: Record<string, HarnessAccountView> = {};
  let github: GithubCheck | null = null;
  if (server) {
    const get = async <T>(path: string): Promise<T | null> => {
      try {
        const res = await fetch(`${server}/api${path}`, { headers: authed() });
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const [h, a, g] = await Promise.all([get<H[]>('/harnesses'), get<AccountsView>('/accounts'), get<GithubCheck>('/setup/github')]);
    list = h;
    // An older server answers these with something else: no accounts, and gh checked here instead.
    accounts = Array.isArray(a?.machines) ? accountsByHarness(machineAccounts(a, 'here')) : {};
    github = g && g.state in HARNESS_CHECK_LABEL ? g : null;
  }
  // The same check the server runs, here when it is not running (or is older than GET /api/setup/github).
  github ??= await githubAuth();
  if (!list) {
    const has = (bin: string) => !!sh('/bin/sh', ['-c', `command -v ${bin}`]);
    const bins: [HarnessId, string, string][] = [
      ['claude-code', 'claude', 'claude (then /login)'],
      ['codex', 'codex', 'codex login'],
      ['cursor', 'cursor-agent', 'cursor-agent login'],
      ['antigravity', 'agy', 'agy (then sign in with Google)'],
      ['opencode', 'opencode', 'opencode (the free models need no sign-in)'],
    ];
    list = bins.map(([id, bin, fix]) => (has(bin) ? { id, name: HARNESS_META[id].name, available: true } : { id, name: HARNESS_META[id].name, available: false, missing: true, fix, install: HARNESS_INSTALL[id] }));
    say('   (Omni is not running, so this only checks the CLIs are on PATH, not that they are signed in.)');
  }
  const pad = Math.max(...Object.values(HARNESS_CHECK_LABEL).map((l) => l.length));
  const indent = ' '.repeat(pad + 5);
  for (const h of list) {
    // Remote harnesses are opt-in: listed once they work, never as missing. So is Antigravity until agy is installed.
    if ((h.id === 'hermes' || h.id === 'cursor-cloud' || ((h.id === 'antigravity' || h.id === 'opencode') && h.missing)) && !h.available) continue;
    const check = harnessCheck(h);
    say(`   ${HARNESS_CHECK_LABEL[check.state].toLowerCase().padEnd(pad)}  ${h.name}`);
    if (h.id === 'codex') say(`${indent}Optional. Reviews a pull request Claude wrote when you ask the Conductor for a review.`);
    if (check.install) say(`${indent}install: ${check.install}`);
    if (check.command) say(`${indent}sign in: ${check.command}`);
    if (check.reason) say(`${indent}${check.reason}`);
    const account = harnessAccountLine(accounts[h.id]);
    if (account) say(`${indent}${account}`);
  }
  const gh = github;
  say(`   ${HARNESS_CHECK_LABEL[gh.state].toLowerCase().padEnd(pad)}  GitHub CLI (gh)`);
  say(`${indent}Watching pull requests, Auto-merge, rerunning failed checks and the Conductor's PR reviews all run gh.`);
  if (gh.install) say(`${indent}install: ${gh.install}`);
  if (gh.command) say(`${indent}sign in: ${gh.command}`);
  if (gh.reason) say(`${indent}${gh.reason}`);
  const ghWho = githubLine(gh);
  if (ghWho) say(`${indent}${ghWho}`);
  if (!list.find((h) => h.id === 'claude-code')?.available) say('   Claude Code is the one Omni needs. Codex, Cursor Agent, Antigravity and OpenCode are optional.');
}

async function createChannel(server: string | null, name: string, repo: string, store: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
  const body = {
    id,
    name,
    kind: 'client',
    repo_path: repo ? expandHome(repo) : null,
    use_worktree: repo ? 1 : 0,
    store_domain: store || null,
  };
  if (server) {
    const res = await fetch(`${server}/api/channels`, { method: 'POST', headers: authed({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
    const out = (await res.json()) as { error?: string };
    if (res.status === 409) return say(`   #${id} already exists, kept it.`);
    if (!res.ok) throw new Error(out.error ?? `could not create #${id}`);
  } else {
    const { channels } = await import('../db.ts');
    if (channels.get(id)) return say(`   #${id} already exists, kept it.`);
    channels.create(body as Parameters<typeof channels.create>[0]);
  }
  say(`   Created #${id}.`);
}

function readHeader() {
  return 'usage: npm run setup [-- --yes] [--name <n>] [--email <e>] [--timezone <tz>] [--pronouns <p>] [--workspace <dir>] [--repos <dir>] [--github-owner <o>] [--channel <name>] [--channel-repo <dir>] [--channel-store <domain>]';
}

main()
  .then(() => {
    rl?.close();
    process.exit(0);
  })
  .catch((err) => {
    rl?.close();
    console.error(`\nsetup: ${(err as Error).message}`);
    process.exit(1);
  });
