import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleCli } from '../scripts/bundle.ts';

// The file the desktop app ships and its shim runs (apps/desktop/src/cli-shim.ts): one ESM file that runs as a
// script and exports `run`, which the shim calls with the arguments after `--`.
const out = mkdtempSync(join(tmpdir(), 'omni-cli-bundle-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('the bundled omni command', () => {
  it('runs on its own with the version it was built with, and exports run for the shim', async () => {
    const file = await bundleCli(out, '9.8.7');
    expect(file).toBe(join(out, 'apps', 'cli', 'omni.mjs'));
    expect(execFileSync(process.execPath, [file, '--version'], { encoding: 'utf8' })).toBe('omni 9.8.7\n');
    // As the shim calls it: Node's -e, the arguments after "--", and run's answer as the exit code.
    const boot = `import(${JSON.stringify(pathToFileURL(file).href)}).then((m)=>m.run(process.argv.slice(1))).then((c)=>{process.exitCode=c})`;
    const viaRun = spawnSync(process.execPath, ['-e', boot, '--', 'show', 'not an id'], { encoding: 'utf8' });
    expect(viaRun.status).toBe(3);
    expect(viaRun.stderr).toBe('omni show: not an id is not a thread id. Use the id, its first 8 characters, a link to it, or parent.\n');
  }, 30_000);
});
