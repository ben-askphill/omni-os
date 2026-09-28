// Bundles the slash modules for the Mac app's JavaScriptCore: `npm run build:slash`.
// tests/slash-engine-bundle.test.ts fails when the checked-in bundle differs from `bundleSlashEngine()`.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
export const ENTRY = resolve(root, 'mac/slash-engine/entry.ts');
export const OUT = resolve(root, 'mac/OmniKit/Sources/OmniKit/Resources/slash-engine.js');

/** The bundle as text. Paths in comments are relative, so it is the same on every checkout. */
export async function bundleSlashEngine() {
  const result = await build({
    entryPoints: [ENTRY],
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, await bundleSlashEngine());
  console.log(`wrote ${OUT}`);
}
