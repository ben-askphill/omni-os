import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { libsecretStore } from '../secret-store.ts';

// A store command that exits before reading its stdin closes the pipe under the value being written. Writing more
// than a pipe buffer (64 KiB on Linux and macOS) makes that EPIPE certain. The command's exit decides the result; the
// broken pipe must not escape as an uncaught exception, which would take the server down.

const bin = mkdtempSync(join(tmpdir(), 'omni-secret-pipe-'));
const path = process.env.PATH;
process.env.PATH = `${bin}:${path}`;
afterAll(() => {
  process.env.PATH = path;
  rmSync(bin, { recursive: true, force: true });
});
const tool = (body: string) => writeFileSync(join(bin, 'secret-tool'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
const big = 'x'.repeat(1 << 20);

describe('writing a secret to a command that never reads it', () => {
  it('resolves when the command exits 0', async () => {
    tool('exit 0');
    await expect(libsecretStore.write('scope/NAME', big)).resolves.toBeUndefined();
  });

  it('rejects with the exit code when the command fails', async () => {
    tool('exit 3');
    await expect(libsecretStore.write('scope/NAME', big)).rejects.toThrow('secret-tool exited 3');
  });
});
