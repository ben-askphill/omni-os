// Builds the omni command into one ESM file for the desktop app to run on Electron's Node: <out>/apps/cli/omni.mjs,
// beside the server bundle in the staged app root (apps/desktop/scripts/stage.ts). The shim the app writes imports it
// and calls `run` (apps/desktop/src/cli-shim.ts). The version is the desktop app's, so `omni --version` and doctor
// say which app the command came with.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../..');

export async function bundleCli(out: string, version?: string): Promise<string> {
  const file = join(out, 'apps', 'cli', 'omni.mjs');
  const appVersion = version ?? (JSON.parse(readFileSync(join(REPO, 'apps', 'desktop', 'package.json'), 'utf8')) as { version: string }).version;
  await build({
    entryPoints: [join(REPO, 'apps', 'cli', 'src', 'main.ts')],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    define: { __OMNI_CLI_VERSION__: JSON.stringify(appVersion) },
    logLevel: 'warning',
    legalComments: 'none',
  });
  return file;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: tsx apps/cli/scripts/bundle.ts <out-dir> [version]');
    process.exit(2);
  }
  console.log(await bundleCli(resolve(out), process.argv[3]));
}
