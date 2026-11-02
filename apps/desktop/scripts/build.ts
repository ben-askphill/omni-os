// Builds the main process, the bridge's preload and the Web tab's pick preload into dist/, as CommonJS for Electron.
import { build } from 'esbuild';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const common = {
  bundle: true,
  platform: 'node' as const,
  format: 'cjs' as const,
  target: 'node24',
  external: ['electron'],
  sourcemap: 'linked' as const,
  logLevel: 'warning' as const,
};

await Promise.all([
  build({ ...common, entryPoints: [join(root, 'src/main.ts')], outfile: join(root, 'dist/main.cjs') }),
  build({ ...common, entryPoints: [join(root, 'src/preload.ts')], outfile: join(root, 'dist/preload.cjs') }),
  build({ ...common, entryPoints: [join(root, 'src/pick-preload.ts')], outfile: join(root, 'dist/pick-preload.cjs') }),
]);
