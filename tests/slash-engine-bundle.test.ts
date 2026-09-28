import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUT, bundleSlashEngine } from '../scripts/build-slash-engine.ts';

// The Mac app runs the slash modules from a checked-in bundle. Fails when a change to a slash module
// (or the engine entry) is not in it. Fix: npm run build:slash.
describe('the Mac slash engine bundle', () => {
  it('is what a fresh build makes', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await bundleSlashEngine());
  });
});
