// Bundles the page scripts and their readers for the Mac app's Web tab: `npm run build:pick`.
// apps/mac/tests/browser-pick-bundle.test.ts fails when the checked-in bundle differs from `bundleBrowserPick()`.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleForMac } from './build-slash-engine.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../../..');
export const ENTRY = resolve(root, 'apps/mac/browser-pick/entry.ts');
export const OUT = resolve(root, 'apps/mac/OmniKit/Sources/OmniKit/Resources/browser-pick.js');

export const bundleBrowserPick = () => bundleForMac(ENTRY);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, await bundleBrowserPick());
  console.log(`wrote ${OUT}`);
}
