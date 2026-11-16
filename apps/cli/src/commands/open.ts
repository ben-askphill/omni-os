// `omni open`: a thread or channel in the desktop app, else in the browser. The app takes the page as `--route`,
// also on a second launch while it runs (apps/desktop/src/main.ts), and as an omni:// link.
import { join, sep } from 'node:path';
import { OmniHttpError } from '@omni/client-core';
import { flag, parseArgs } from '../args.ts';
import { client, type Client } from '../connection.ts';
import { CliError, EXIT, UsageError, type Io } from '../io.ts';
import { looksLikeThread, resolveThread } from '../resolve.ts';

/** The .app bundle a Mac binary sits in (/Applications/Omni.app/Contents/MacOS/Omni), or null. */
export function macBundle(binary: string): string | null {
  const i = binary.indexOf('.app/Contents/MacOS/');
  return i < 0 ? null : binary.slice(0, i + '.app'.length);
}

/** How to start the app on `route`: `open` on a Mac (a second launch hands the route to the running app), else the binary or AppImage. */
export function appLaunch(app: string, platform: NodeJS.Platform, route: string): [string, string[]] {
  const bundle = platform === 'darwin' ? macBundle(app) : null;
  // One token: Chromium moves an argument that is not a switch to the end of a second launch's argv.
  const arg = `--route=${route}`;
  return bundle ? ['open', ['-n', '-a', bundle, '--args', arg]] : [app, [arg]];
}

export async function openRoute(c: Client, io: Io, route: string, o: { quiet?: boolean } = {}): Promise<void> {
  const say = (text: string) => !o.quiet && io.out(text);
  const app = c.conn.app;
  // The app shows the server it runs with: only a page of that server opens there.
  if (app && !c.conn.remote && io.stat(app)) {
    const [bin, args] = appLaunch(app, io.platform, route);
    if (await io.launch(bin, args)) {
      say(`Opened ${route} in the Omni app.\n`);
      return;
    }
  }
  const url = c.link(route);
  if (await io.launch(io.platform === 'darwin' ? 'open' : 'xdg-open', [url])) {
    say(`Opened ${url} in your browser.\n`);
    return;
  }
  throw new CliError(`Could not start a browser. Open ${url}`);
}

const within = (dir: string, path: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** "." : the thread whose worktree this is, the thread this runs in, or the channel whose folder this is. */
async function hereRoute(c: Client, io: Io): Promise<string> {
  const worktrees = c.conn.dataDir ? join(c.conn.dataDir, 'worktrees') : null;
  const m = io.cwd.match(/[\\/]worktrees[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\\/]|$)/i);
  if (m && (!worktrees || within(worktrees, io.cwd))) return `#/t/${m[1].toLowerCase()}`;
  if (c.conn.thread) return `#/t/${c.conn.thread}`;
  const channels = await c.api.channels();
  let best: { id: string; depth: number } | null = null;
  for (const ch of channels) {
    for (const dir of [ch.repo_path, ch.base_dir]) {
      if (!dir || !within(dir.replace(/[\\/]+$/, ''), io.cwd)) continue;
      if (!best || dir.length > best.depth) best = { id: ch.id, depth: dir.length };
    }
  }
  if (best) return `#/c/${encodeURIComponent(best.id)}`;
  throw new CliError(`No channel has ${io.cwd} as its folder. Name a thread or channel instead.`);
}

async function routeFor(c: Client, io: Io, target: string): Promise<string> {
  if (target === '.') return hereRoute(c, io);
  if (looksLikeThread(target)) return `#/t/${encodeURIComponent(await resolveThread(c, target))}`;
  try {
    const ch = await c.api.channel(target);
    return `#/c/${encodeURIComponent(ch.id)}`;
  } catch (err) {
    if (err instanceof OmniHttpError && err.failure.kind === 'http' && err.failure.status === 404) throw new CliError(`No channel or thread named ${target}.`);
    throw err;
  }
}

export async function openCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, { pair: {} }, 'open');
  const [target, extra] = p.positional;
  if (extra) throw new UsageError(`unexpected ${extra}`, 'open');
  if (target === '') throw new UsageError('say which thread or channel to open', 'open');
  const c = client(io);
  const route = target === undefined ? '#/' : await routeFor(c, io, target);
  if (flag(p, 'pair')) {
    // The page swaps ?pair= for a session cookie and drops it from the address bar (apps/web/src/components/Pair.tsx).
    const token = c.conn.token();
    if (!token) throw new CliError('No API token to pair with. Set OMNI_TOKEN, or run this on the machine Omni runs on.');
    // The link carries the token: it names only a server that proved it holds it.
    await c.prove();
    io.out(`${c.link(route)}?pair=${encodeURIComponent(token)}\n`);
    return EXIT.ok;
  }
  await openRoute(c, io, route);
  return EXIT.ok;
}
