// The command line the app takes. A packaged app usually gets none; development and the QA harness
// (scripts/qa.ts) name the port and data dir of a server to start or attach to.

export interface LaunchOptions {
  /** Run the server from this checkout's TypeScript instead of the packaged bundle. */
  dev: boolean;
  port: number;
  /** Where the server keeps its state. Null: the app's default, or the one the user picked once (backend/data-dir.ts). */
  dataDir: string | null;
  /** Load the UI from here instead of the server, such as Vite's dev server. Pairing still goes to the server. */
  appUrl: string | null;
  /** Open this hash route in the first window. */
  route: string | null;
}

export const DEFAULT_PORT = 4747;

export function parseOptions(argv: readonly string[]): LaunchOptions | { error: string } {
  const out: LaunchOptions = { dev: false, port: DEFAULT_PORT, dataDir: null, appUrl: null, route: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--dev':
        out.dev = true;
        break;
      case '--port': {
        const text = value();
        const port = Number(text);
        if (!text || !Number.isInteger(port) || port < 1 || port > 65535) return { error: '--port needs a port from 1 to 65535' };
        out.port = port;
        break;
      }
      case '--data-dir': {
        const text = value();
        if (!text) return { error: '--data-dir needs a path' };
        out.dataDir = text;
        break;
      }
      case '--app-url': {
        const text = value();
        if (!text || !/^https?:\/\//.test(text)) return { error: '--app-url needs an http(s) URL' };
        out.appUrl = text.replace(/\/+$/, '');
        break;
      }
      case '--route': {
        const text = value();
        if (!text || !text.startsWith('#/')) return { error: '--route needs a hash route such as #/settings' };
        out.route = text;
        break;
      }
      default:
        // Chromium and the OS add switches of their own (macOS's -psn_..., --no-sandbox): leave them be.
        break;
    }
  }
  return out;
}

/** A route the page may ask a window to open: a hash route of the Web UI, nothing that leaves it. */
export function safeRoute(route: unknown): string | null {
  if (typeof route !== 'string' || !route.startsWith('#/') || route.length > 2000) return null;
  return /[\s<>"'`\\]/.test(route) ? null : route;
}
