// npm exec --workspace @omni/shared -- tsx scripts/build-tab-icons.ts
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { ICON_PATHS } from '../icons.ts';

const names = ['inbox', 'hash', 'layers', 'plus'] as const;
const dir = new URL('../../../apps/ios/src/navigation/tab-icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const name of names) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24"><path d="${ICON_PATHS[name]}" fill="none" stroke="black" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  writeFileSync(new URL(`${name}@3x.png`, dir), await sharp(Buffer.from(svg)).png().toBuffer());
}
writeFileSync(new URL('paths.json', dir), JSON.stringify({ hash: createHash('sha256').update(JSON.stringify(names.map((n) => ICON_PATHS[n]))).digest('hex') }) + '\n');
