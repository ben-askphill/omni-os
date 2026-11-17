import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { signMac, TIMESTAMP_RETRY_WAITS, OTHER_RETRY_WAITS } = require('../scripts/mac-sign.cjs');

// The error Node's execFile raised on 0.1.33's release runs, with codesign's stderr in its message.
const timestampError = new Error(
  'Command failed: codesign --sign Developer ID Application --force --timestamp --options runtime .../codicon-DCmgc-ay.ttf\n' +
    '.../codicon-DCmgc-ay.ttf: A timestamp was expected but was not found.',
);

/** A signApp that throws each queued error in turn, then succeeds. */
function fakeSign(errors: Error[]) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    signApp: async (opts: Record<string, unknown>) => {
      calls.push(opts);
      const error = errors.shift();
      if (error) throw error;
    },
  };
}

function run(errors: Error[], extra: Record<string, unknown> = {}) {
  const sign = fakeSign(errors);
  const waits: number[] = [];
  const done = signMac(
    { app: 'Omni.app', identity: 'HASH' },
    { signApp: sign.signApp, wait: async (s: number) => void waits.push(s), log: () => {}, ...extra },
  );
  return { done, waits, calls: sign.calls };
}

describe('signMac', () => {
  it('signs once when codesign succeeds', async () => {
    const { done, waits, calls } = run([]);
    await done;
    expect(calls).toEqual([{ app: 'Omni.app', identity: 'HASH' }]);
    expect(waits).toEqual([]);
  });

  it('waits out a timestamp outage longer than electron-builder would', async () => {
    const { done, waits, calls } = run([timestampError, timestampError, timestampError, timestampError, timestampError]);
    await done;
    expect(calls).toHaveLength(6);
    expect(waits).toEqual(TIMESTAMP_RETRY_WAITS.slice(0, 5));
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThan(9 * 60);
  });

  it('gives up with the timestamp error once the waits run out', async () => {
    const errors = Array.from({ length: TIMESTAMP_RETRY_WAITS.length + 1 }, () => timestampError);
    const { done, waits } = run(errors);
    await expect(done).rejects.toBe(timestampError);
    expect(waits).toEqual(TIMESTAMP_RETRY_WAITS);
  });

  it('keeps electron-builder’s short retries for any other error', async () => {
    const other = new Error('Command failed: codesign\nOmni.app: errSecInternalComponent');
    const { done, waits, calls } = run(Array.from({ length: OTHER_RETRY_WAITS.length + 1 }, () => other));
    await expect(done).rejects.toBe(other);
    expect(waits).toEqual(OTHER_RETRY_WAITS);
    expect(calls).toHaveLength(OTHER_RETRY_WAITS.length + 1);
  });

  it('signs with the named identity instead of the one electron-builder found', async () => {
    const { done, calls } = run([], { identity: 'Apple Development: Ben' });
    await done;
    expect(calls[0]).toEqual({ app: 'Omni.app', identity: 'Apple Development: Ben' });
  });
});
