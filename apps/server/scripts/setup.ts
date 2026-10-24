// `npm run setup`: the onboarding wizard in a terminal. Asks what the web and Mac wizards ask and writes the same
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

async function serverUrl() {
  const url = process.env.OMNI_URL ?? `http://127.0.0.1:${process.env.OMNI_PORT ?? 4747}`;
  try {
    const res = await fetch(`${url}/api/setup`, { headers: authed(), signal: AbortSignal.timeout(1500) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
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
  say('');

  say('2. Workspace');
  say('   The workspace folder is where threads without a repo run; its CLAUDE.md and skills load in every Claude thread.');
  const root = await ask('Workspace folder', cur.workspace.root || tildify(fb.workspaceRoot), { flag: 'workspace' });
  const reposDir = await ask('Folder with your git checkouts', cur.workspace.reposDir || tildify(fb.reposDir), { flag: 'repos' });
  const ghLogin = sh('gh', ['api', 'user', '--jq', '.login']);
  const githubOwner = await ask('GitHub owner (user or org)', cur.workspace.githubOwner || ghLogin || omniRepo()?.split('/')[0] || '', {
    flag: 'github-owner',
    check: (v) => (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(v) ? null : 'A GitHub owner is a user or org name, like octocat.'),
  });
  say('');

  const patch: UserConfigPatch = {
    user: { name, email, timezone: timezone === fb.timezone && !cur.user.timezone ? '' : timezone, pronouns: pronouns || 'they/them' },
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
  say(server ? `   Open ${server} (or the Mac app).` : '   Start Omni with `npm run dev` (web on http://localhost:4748) or open the Mac app.');
  say('   Change any of this later in Settings, or run `npm run setup` again.');
}

/** Which CLIs are installed and signed in, from the running server's probe when there is one. */
async function harnesses(server: string | null) {
  type H = { id: string; name: string; available: boolean; fix?: string; install?: string };
  let list: H[] | null = null;
  if (server) {
    try {
      list = (await (await fetch(`${server}/api/harnesses`, { headers: authed() })).json()) as H[];
    } catch {
      list = null;
    }
  }
  if (!list) {
    const has = (bin: string) => !!sh('/bin/sh', ['-c', `command -v ${bin}`]);
    const bins: [HarnessId, string, string][] = [
      ['claude-code', 'claude', 'claude (then /login)'],
      ['codex', 'codex', 'codex login'],
      ['cursor', 'cursor-agent', 'cursor-agent login'],
    ];
    list = bins.map(([id, bin, fix]) => ({ id, name: HARNESS_META[id].name, available: has(bin), fix, install: HARNESS_INSTALL[id] }));
    say('   (Omni is not running, so this only checks the CLIs are on PATH, not that they are signed in.)');
  }
  for (const h of list) {
    // Remote harnesses are opt-in: listed once they work, never as missing.
    if ((h.id === 'hermes' || h.id === 'cursor-cloud') && !h.available) continue;
    say(`   ${h.available ? 'ready  ' : 'missing'}  ${h.name}`);
    if (!h.available) {
      if (h.install) say(`            install: ${h.install}`);
      if (h.fix) say(`            sign in: ${h.fix}`);
    }
  }
  if (!list.find((h) => h.id === 'claude-code')?.available) say('   Claude Code is the one Omni needs; the others are optional.');
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
