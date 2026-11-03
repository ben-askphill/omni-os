// Builds the server and its stdio MCP scripts into single ESM files, for the desktop app to run on Electron's Node:
// <out>/apps/server/index.mjs and <out>/apps/mcp/<name>.mjs, the repo's own layout, so config.ts's ROOT holds there.
// Packages that must stay files on disk are left external, and the caller installs them under <out>/node_modules.
import { build } from 'esbuild';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../..');

/**
 * Left out of the bundle. node-pty loads a native addon and finds its spawn helper beside its package.json.
 * @playwright/mcp is started as a CLI from its package path (sandbox.ts). Nothing bundled loads tsx: when BUNDLED,
 * the MCP scripts run as .mjs on process.execPath (config.ts).
 */
export const EXTERNAL = ['node-pty', '@playwright/mcp'] as const;

export const MCP_SCRIPTS = ['omni', 'ask', 'render', 'threads'] as const;

// CJS dependencies call require(); an ESM bundle has none of its own.
const banner = { js: "import { createRequire as __omniRequire } from 'node:module'; const require = __omniRequire(import.meta.url);" };

export async function bundleServer(out: string): Promise<{ server: string; mcp: string[] }> {
  const server = join(out, 'apps', 'server', 'index.mjs');
  const mcp = MCP_SCRIPTS.map((name) => join(out, 'apps', 'mcp', `${name}.mjs`));
  const common = {
    bundle: true,
    platform: 'node' as const,
    format: 'esm' as const,
    target: 'node24',
    external: [...EXTERNAL],
    banner,
    logLevel: 'warning' as const,
    legalComments: 'none' as const,
  };
  await build({ ...common, entryPoints: [join(REPO, 'apps', 'server', 'index.ts')], outfile: server });
  await Promise.all(
    MCP_SCRIPTS.map((name, i) => build({ ...common, entryPoints: [join(REPO, 'apps', 'mcp', `${name}.ts`)], outfile: mcp[i] })),
  );
  return { server, mcp };
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: tsx apps/server/scripts/bundle.ts <out-dir>');
    process.exit(2);
  }
  const built = await bundleServer(resolve(out));
  console.log([built.server, ...built.mcp].join('\n'));
}
