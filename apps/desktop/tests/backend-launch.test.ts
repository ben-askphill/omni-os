// Tests for src/backend/launch.ts and process.ts, the code that came from the Linux launcher (ADR 0006).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  checkoutMessage, checkoutProblem, childEnv, classifyAnswer, decide, exitMessage, extractPath, probePort, proofFor,
  serverCommand, settleProbe, shouldRestart, tokenFile, waitForReady,
} from '../src/backend/launch.ts';
import { stopGroup } from '../src/backend/process.ts';

const TOKEN = 'a'.repeat(64);
const NONCE = 'ab'.repeat(16);

describe('proof', () => {
  it('matches the server HMAC of omni-proof:port:nonce', () => {
    expect(proofFor(TOKEN, 4747, NONCE)).toBe('6cc24632cb5d7a85c69c27f43df9166b102dea5833504a44d5f2cef0b2a65810');
  });

  it('classifies a proof, a mismatch, a missing token and anything else', () => {
    const body = JSON.stringify({ proof: proofFor(TOKEN, 4747, NONCE) });
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('omni');
    expect(classifyAnswer({ token: 'b'.repeat(64), port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('not-this-install');
    expect(classifyAnswer({ token: null, port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('no-token');
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 404, body: 'nope' }).kind).toBe('not-omni');
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 200, body: '{' }).kind).toBe('not-omni');
  });

  it('does not accept a proof made for another port', () => {
    const body = JSON.stringify({ proof: proofFor(TOKEN, 4748, NONCE) });
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('not-this-install');
  });
});

describe('login PATH', () => {
  it('reads PATH from between the markers', () => {
    expect(extractPath('noise\nOMNISTARTabc\n/usr/bin:/bin\nOMNIENDabc\n', 'abc')).toBe('/usr/bin:/bin');
    expect(extractPath('OMNISTARTabc\n\nOMNIENDabc', 'abc')).toBeNull();
    expect(extractPath('no markers', 'abc')).toBeNull();
  });
});

describe('server env', () => {
  it('keeps the display, names the data dir and runs as Node, and drops billing keys', () => {
    const env = childEnv(
      {
        HOME: '/home/me',
        WAYLAND_DISPLAY: 'wayland-1',
        ANTHROPIC_API_KEY: 'sk',
        OPENAI_API_KEY: 'sk',
        OMNI_TOKEN: 'secret',
        OMNI_DATA_DIR: '/somewhere/else',
        PATH: '/bad',
      },
      { path: '/home/me/.local/bin:/usr/bin', port: 4747, dataDir: '/data' },
    );
    expect(env.HOME).toBe('/home/me');
    expect(env.WAYLAND_DISPLAY).toBe('wayland-1');
    expect(env.PATH).toBe('/home/me/.local/bin:/usr/bin');
    expect(env.NODE_ENV).toBe('production');
    expect(env.OMNI_PORT).toBe('4747');
    expect(env.OMNI_DATA_DIR).toBe('/data');
    expect(env.OMNI_SUPERVISOR).toBe('desktop');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OMNI_TOKEN).toBeUndefined();
  });

  it('reads the token from the data dir the server is given', () => {
    expect(tokenFile('/data')).toBe('/data/api-token');
  });

  it('runs the bundle when packaged and the checkout through tsx in development', () => {
    expect(serverCommand({ bundled: true, appRoot: '/app' })).toEqual({ args: ['/app/apps/server/index.mjs'], cwd: '/app' });
    expect(serverCommand({ bundled: false, appRoot: '/repo' })).toEqual({ args: ['--import', 'tsx', 'apps/server/index.ts'], cwd: '/repo' });
  });
});

describe('decide', () => {
  it('starts when the port is free and attaches when the proof matches', () => {
    expect(decide({ kind: 'free' }, 4747)).toEqual({ action: 'start' });
    expect(decide({ kind: 'omni' }, 4747)).toEqual({ action: 'attach' });
    expect(decide({ kind: 'not-this-install' }, 4747).action).toBe('fail');
    expect(decide({ kind: 'no-token' }, 4747).action).toBe('fail');
    const foreign = decide({ kind: 'not-omni', detail: 'the answer was not an Omni proof' }, 9);
    expect(foreign.action).toBe('fail');
    if (foreign.action === 'fail') expect(foreign.message).toBe('Port 9 answers, but not as an Omni server. The answer was not an Omni proof. Stop that program, or pick another port.');
  });

  it('retries a slow answer, so a busy or just-restarted server is attached to, not refused', async () => {
    let n = 0;
    const settled = await settleProbe(async () => (n++ < 3 ? { kind: 'slow' } : { kind: 'omni' }), async () => {});
    expect(settled).toEqual({ kind: 'omni' });
    expect(decide(settled, 4747)).toEqual({ action: 'attach' });
    const stuck = await settleProbe(async () => ({ kind: 'slow' }), async () => {}, 4);
    expect(stuck).toEqual({ kind: 'slow' });
    expect(decide(stuck, 4747).action).toBe('fail');
  });

  it('names a missing checkout and missing dependencies', () => {
    expect(checkoutProblem('/repo', () => false)).toBe('missing');
    expect(checkoutProblem('/repo', (path) => path.endsWith('apps/server/index.ts'))).toBe('dependencies');
    expect(checkoutProblem('/repo', () => true)).toBeNull();
    expect(checkoutMessage('dependencies', '/repo')).toContain('npm install --include=dev');
  });

  it('waits until the proof matches, and reports an early exit with the log tail apart', async () => {
    let n = 0;
    const ready = await waitForReady({
      probe: async () => (n++ < 2 ? { kind: 'free' } : { kind: 'omni' }),
      exited: () => null,
      sleep: async () => {},
      attempts: 5,
      port: 4747,
      logTail: () => '',
      cancelled: () => false,
    });
    expect(ready).toEqual({ ok: true });
    const died = await waitForReady({
      probe: async () => {
        throw new Error('should not probe');
      },
      exited: () => 1,
      sleep: async () => {},
      attempts: 3,
      port: 4747,
      logTail: () => 'port in use\n',
      cancelled: () => false,
    });
    expect(died).toEqual({ ok: false, message: 'The server stopped while starting, with exit code 1.', logTail: 'port in use' });
  });

  it('gives up after its attempts', async () => {
    const slow = await waitForReady({
      probe: async () => ({ kind: 'free' }),
      exited: () => null,
      sleep: async () => {},
      attempts: 3,
      port: 4747,
      logTail: () => '',
      cancelled: () => false,
    });
    expect(slow).toEqual({ ok: false, message: 'The server did not answer within 30 seconds.', logTail: '' });
  });

  it('words a stop after ready by its exit code', () => {
    expect(exitMessage(0)).toBe('The server stopped.');
    expect(exitMessage(137)).toBe('The server stopped with exit code 137.');
  });
});

describe('process', () => {
  it('stops a process group it started', async () => {
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    expect(child.pid).toBeTruthy();
    await stopGroup(child.pid!);
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });
});

describe('probe', () => {
  it('recognises this install, another install, and a closed port', async () => {
    const token = 'c'.repeat(64);
    const server = createServer((req, res) => {
      const nonce = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('nonce') ?? '';
      const port = (server.address() as AddressInfo).port;
      res.end(JSON.stringify({ proof: proofFor(token, port, nonce) }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      expect((await probePort(port, token)).kind).toBe('omni');
      expect((await probePort(port, 'd'.repeat(64))).kind).toBe('not-this-install');
      expect((await probePort(port, null)).kind).toBe('no-token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const refused = new TypeError('fetch failed');
    refused.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const fetchRefused: typeof fetch = async () => {
      throw refused;
    };
    expect((await probePort(9, token, fetchRefused)).kind).toBe('free');
    const fetchTimeout: typeof fetch = async () => {
      throw new DOMException('timed out', 'TimeoutError');
    };
    expect((await probePort(9, token, fetchTimeout)).kind).toBe('slow');
  });
});

describe('shouldRestart', () => {
  it('starts the server again only after Update, and not in a loop', () => {
    expect(shouldRestart(75, 60_000)).toBe(true);
    expect(shouldRestart(75, 2_000)).toBe(false);
    expect(shouldRestart(0, 60_000)).toBe(false);
    expect(shouldRestart(1, 60_000)).toBe(false);
    expect(shouldRestart(null, 60_000)).toBe(false);
  });
});
