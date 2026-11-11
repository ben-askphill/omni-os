// The activity monitor's sampler reads Claude transcripts from ~/.claude, whatever CLAUDE_CONFIG_DIR says: Omni
// strips that variable from Claude Code threads, so they always write there. Runs the real sampler on a temp HOME.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// quick-prompt.ts sets Electron switches as it loads, which needs a running app.
vi.mock('../src/quick-prompt.ts', () => ({ installQuickPrompt: () => {} }));
import { MONITOR_SCRIPT, monitorEnv, monitorUrl } from '../src/activity-monitor.ts';

const SCRIPT = resolve(import.meta.dirname, '../../..', MONITOR_SCRIPT);

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => done(port));
    });
  });
}

/** One Claude transcript with a single assistant turn, timestamped now so the sampler backfills it. */
function writeTranscript(projectsDir: string, sessionId: string): void {
  const dir = join(projectsDir, 'proj');
  mkdirSync(dir, { recursive: true });
  const line = {
    type: 'assistant',
    sessionId,
    timestamp: new Date().toISOString(),
    message: { id: `msg-${sessionId}`, model: 'claude-test', usage: { input_tokens: 10, output_tokens: 20 } },
  };
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(line)}\n`);
}

/** The session ids in the sampler's first snapshot. */
async function sessionIds(port: number): Promise<string[]> {
  const abort = new AbortController();
  const res = await fetch(`${monitorUrl(port)}events`, { signal: abort.signal });
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  abort.abort();
  const data = text.split('\n').find((l) => l.startsWith('data: '));
  const snap = JSON.parse(data!.slice('data: '.length)) as { sessions: { id: string }[] };
  return snap.sessions.map((s) => s.id);
}

let child: ChildProcess | null = null;
let tmp: string | null = null;

afterEach(() => {
  child?.kill('SIGKILL');
  child = null;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

/** Starts the sampler with `env` and waits until it answers. */
async function startSampler(env: Record<string, string>, port: number): Promise<void> {
  child = spawn(process.execPath, [SCRIPT], { env, stdio: 'ignore' });
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(monitorUrl(port))).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('sampler did not start');
}

/** A temp HOME with one session in ~/.claude, and a CLAUDE_CONFIG_DIR elsewhere with another. */
function fixture(): { home: string; configDir: string } {
  tmp = mkdtempSync(join(tmpdir(), 'omni-monitor-'));
  const home = join(tmp, 'home');
  const configDir = join(tmp, 'bogus-claude-config');
  writeTranscript(join(home, '.claude', 'projects'), 'from-home');
  writeTranscript(join(configDir, 'projects'), 'from-config-dir');
  return { home, configDir };
}

describe('activity monitor sampler', () => {
  it('never forwards CLAUDE_CONFIG_DIR to the sampler', () => {
    const env = monitorEnv({ HOME: '/h', PATH: '/bin', CLAUDE_CONFIG_DIR: '/elsewhere' }, 4791);
    expect('CLAUDE_CONFIG_DIR' in env).toBe(false);
    expect(env.HOME).toBe('/h');
  });

  // The sampler reads macOS tools (vm_stat, sysctl), so it only runs on a Mac.
  it.skipIf(process.platform !== 'darwin')('reads ~/.claude when CLAUDE_CONFIG_DIR points elsewhere', async () => {
    const { home, configDir } = fixture();
    const port = await freePort();
    // Set on the sampler itself too, as when someone starts it by hand from a shell that exports it.
    await startSampler({ ...monitorEnv({ HOME: home, PATH: process.env.PATH ?? '' }, port), CLAUDE_CONFIG_DIR: configDir }, port);
    const ids = await sessionIds(port);
    expect(ids).toContain('from-home');
    expect(ids).not.toContain('from-config-dir');
  }, 20_000);

  it.skipIf(process.platform !== 'darwin')('reads ~/.claude when CLAUDE_CONFIG_DIR is unset', async () => {
    const { home } = fixture();
    const port = await freePort();
    await startSampler(monitorEnv({ HOME: home, PATH: process.env.PATH ?? '' }, port), port);
    expect(await sessionIds(port)).toEqual(['from-home']);
  }, 20_000);
});
