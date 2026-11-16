import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// The catalog's Codex probe on a busy server. On omarchy the server's thread sat in synchronous disk writes for seconds
// at a time, so Codex's answer waited unread in the pipe until the probe's deadline fired, and Omni reported a
// signed-in Codex as "Run `codex login`".
let svc: typeof import('../harness/catalog-service.ts');
let CodexClient: typeof import('../harness/codex/client.ts').CodexClient;

beforeAll(async () => {
  await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  svc = await import('../harness/catalog-service.ts');
  ({ CodexClient } = await import('../harness/codex/client.ts'));
});

afterEach(() => vi.restoreAllMocks());

/** Hold this thread, as a synchronous disk write on a busy machine holds the server's. */
const block = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Block the server's thread for `ms` right after the probe sends `method`, while Codex answers it. */
function stallAfter(method: string, ms: number) {
  const request = CodexClient.prototype.request;
  vi.spyOn(CodexClient.prototype, 'request').mockImplementation(function (this: InstanceType<typeof CodexClient>, m, params, opts) {
    const answer = request.call(this, m, params, opts);
    if (m === method) block(ms);
    return answer;
  });
}

/** Run fn with these env vars set for the fake Codex the probe starts. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
  }
}

describe('the Codex probe on a busy server', () => {
  it('sees a signed-in Codex when the server stalls past the deadline while Codex answers', async () => {
    stallAfter('account/read', 5_500);
    const probe = await svc.probeCodex(FAKE_CODEX);
    expect(probe.available).toBe(true);
    expect(probe.models.map((m) => m.id)).toContain('gpt-5.6-sol');
  }, 20_000);

  it('waits out a stall on the first answer too', async () => {
    stallAfter('initialize', 600);
    // Started from the check phase, so the overdue timer runs before the poll that reads the answer, as on the server.
    const probe = await new Promise<Awaited<ReturnType<typeof svc.probeCodex>>>((done) =>
      setImmediate(() => void svc.probeCodex(FAKE_CODEX, { startMs: 300, silenceMs: 300 }).then(done)),
    );
    expect(probe.available).toBe(true);
  });

  it('still gives up on a Codex that never answers, and says which request it left unanswered', async () => {
    const probe = await withEnv({ FAKE_CODEX_SILENT: 'account/read' }, () => svc.probeCodex(FAKE_CODEX, { silenceMs: 300 }));
    expect(probe).toMatchObject({ available: false, models: [], fix: 'Codex did not answer account/read within 0.3 s. Omni asks again when the model picker opens' });
  });
});

describe('the fix hint names the cause', () => {
  it('signed out: codex login', async () => {
    const probe = await withEnv({ FAKE_CODEX_ACCOUNT: 'none' }, () => svc.probeCodex(FAKE_CODEX));
    expect(probe.fix).toBe('codex login');
  });

  it('an API key login: sign in with ChatGPT instead', async () => {
    const probe = await withEnv({ FAKE_CODEX_ACCOUNT: 'apiKey' }, () => svc.probeCodex(FAKE_CODEX));
    expect(probe.fix).toBe('Signed in with an API key, not a ChatGPT plan. Run codex login');
  });

  it('no codex on PATH', async () => {
    expect((await svc.probeCodex(null)).fix).toBe('Omni found no codex on its PATH. Install Codex or set OMNI_CODEX_BIN to its path');
  });

  it('a codex that will not run', async () => {
    expect((await svc.probeCodex('/nonexistent/codex')).fix).toBe(
      'Omni could not run /nonexistent/codex (ENOENT). Set OMNI_CODEX_BIN to a codex that runs',
    );
  });

  it('a codex that exits before it answers, with the last line it printed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-codex-exit-'));
    const bin = join(dir, 'codex');
    writeFileSync(bin, '#!/bin/sh\necho "starting" >&2\necho "Error loading config.toml: unknown field" >&2\nexit 1\n', { mode: 0o755 });
    try {
      expect((await svc.probeCodex(bin)).fix).toBe(
        'codex app-server exited (code 1) before it answered: Error loading config.toml: unknown field. Run codex app-server in a terminal to see why',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows the cause in the catalog and in the error delegate gets', async () => {
    const { codexHarness, unavailableError } = await import('../harness/catalog.ts');
    const fix = 'Codex did not answer account/read within 5 s. Omni asks again when the model picker opens';
    const h = codexHarness({ available: false, models: [], fix }, 2);
    expect(h).toMatchObject({ available: false, fix, models: [] });
    expect(unavailableError(h.name, h.fix)).toBe(`Codex is not available. ${fix}`);
    expect(codexHarness({ available: false, models: [] }, 2).fix).toBe('codex login');
  });
});
