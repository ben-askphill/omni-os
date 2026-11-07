import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { ICON_PATHS } from '../icons.ts';

it('keeps UIKit template images in sync with the shared drawings', () => {
  const names = ['inbox', 'hash', 'layers', 'plus'] as const;
  const recorded = JSON.parse(readFileSync(new URL('../../../apps/ios/src/navigation/tab-icons/paths.json', import.meta.url), 'utf8'));
  expect(recorded.hash, 'Run npx tsx packages/shared/scripts/build-tab-icons.ts').toBe(createHash('sha256').update(JSON.stringify(names.map((n) => ICON_PATHS[n]))).digest('hex'));
  for (const name of names) {
    const png = readFileSync(new URL(`../../../apps/ios/src/navigation/tab-icons/${name}@3x.png`, import.meta.url));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(72);
    expect(png.readUInt32BE(20)).toBe(72);
  }
});
