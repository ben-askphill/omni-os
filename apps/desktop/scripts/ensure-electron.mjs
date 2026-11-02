// npm runs no install script it has not been told to trust, so electron's own download may not have happened.
// Fetches the binary once, the way electron's install.js does on a trusted install.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('electron/package.json'));
if (!existsSync(join(root, 'path.txt'))) {
  const result = spawnSync(process.execPath, [join(root, 'install.js')], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
