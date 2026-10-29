import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUT, bundleBrowserPick } from '../scripts/build-browser-pick.ts';

// The Mac app's Web tab reads its page with a checked-in bundle of the scripts and readers the server uses. Fails when a
// change to packages/shared/browser-pick-script.ts, browser-pick-read.ts (or what they import) is not in it.
// Fix: npm run build:pick.
describe('the Mac browser-pick bundle', () => {
  it('is what a fresh build makes', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await bundleBrowserPick());
  });
});
