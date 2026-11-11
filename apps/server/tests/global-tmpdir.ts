import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test file makes temp dirs with mkdtemp(tmpdir()) and most never remove them: each run used to leave
// about 70 MB in /tmp, and on Linux /tmp is a quota'd tmpfs that every Claude session writes to.
// So the whole run gets one dir of its own: TMPDIR points there before vitest forks its workers, which inherit
// it, as do the servers and fake CLIs they spawn. Teardown removes it. A run killed before teardown leaves its
// dir behind; the next run removes run dirs untouched for a day, which no live run is.
const PREFIX = 'omni-test-';
const STALE_MS = 24 * 60 * 60 * 1000;

export default function setup(): () => void {
  const parent = tmpdir();
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(PREFIX)) continue;
    const path = join(parent, name);
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true });
    } catch {
      // Another run removed it first.
    }
  }
  const dir = mkdtempSync(join(parent, PREFIX));
  process.env.TMPDIR = dir;
  return () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}
