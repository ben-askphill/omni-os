import { describe, expect, it } from 'vitest';
import { proofFor } from '../src/commands/doctor.ts';
import { fake, TOKEN, wire } from './helpers.ts';

const DATA = '/home/me/.local/share/omni-os/data';
const LOG = '/home/me/.local/state/omni-os/server.log';
const APP = '/home/me/Applications/Omni.AppImage';

/** The install as the shim describes it, with its token file, database and log. */
const install = (log = '[omni] listening on 4747\n') => ({
  env: { OMNI_TOKEN: undefined, OMNI_APP: APP, OMNI_INSTALL_DATA_DIR: DATA, OMNI_INSTALL_LOG: LOG, OMNI_INSTALL_PORT: '4747', HOME: '/home/me', TMPDIR: '/tmp' },
  files: { [`${DATA}/api-token`]: `${TOKEN}\n`, [LOG]: log },
  stats: { [APP]: { mode: 0o100755 }, [DATA]: { dir: true, mode: 0o40700 }, [`${DATA}/omni.db`]: {} },
});

const signedIn = (bin: string) => {
  if (bin === 'claude') return { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'me@example.com' }) };
  if (bin === 'codex') return { stdout: 'Logged in using ChatGPT\n' };
  return { stdout: 'github.com\n  ✓ Logged in to github.com account octo (keyring)\n  - Token: gho_************************************\n' };
};

describe('omni doctor', () => {
  it('finds the server down and still checks everything it can, with the end of the log', async () => {
    const f = fake({ ...install('ok line\nError: listen EADDRINUSE: address already in use 127.0.0.1:4747\n'), run: signedIn, routes: [{ method: 'GET', path: /^\/api\/auth\/proof/, reply: { refused: true } }] });
    expect(await f.run('doctor')).toBe(1);
    const out = f.out();
    expect(out).toMatch(/^ok\s+omni\s+dev, runs on \/home\/me\/Applications\/Omni.AppImage$/m);
    expect(out).toMatch(/^FAIL\s+server\s+nothing answers on http:\/\/127.0.0.1:4747: Omni is not running/m);
    expect(out).toMatch(/^ok\s+token\s+\/home\/me\/.local\/share\/omni-os\/data\/api-token \(the install\) \(not checked: the server is not answering\)$/m);
    expect(out).toMatch(/^ok\s+data\s+\/home\/me\/.local\/share\/omni-os\/data$/m);
    expect(out).toMatch(/^ok\s+disk\s+500 GB free of 1000 GB/m);
    expect(out).toMatch(/^ok\s+claude\s+signed in \(claude.ai, max\)$/m);
    expect(out).toMatch(/^ok\s+codex\s+signed in \(ChatGPT\)$/m);
    expect(out).toMatch(/^ok\s+gh\s+signed in to github.com as octo$/m);
    expect(out).toMatch(/^warn\s+log\s+.*report trouble:$/m);
    expect(out).toContain('| Error: listen EADDRINUSE');
    // Nothing a login check prints is repeated: no email, no token.
    expect(out).not.toContain('me@example.com');
    expect(out).not.toContain('gho_');
  });

  it("checks the server's proof against the token, then that it takes the token", async () => {
    const f = fake({ ...install(), run: signedIn, routes: [] });
    f.route({ method: 'GET', path: '/api/status', reply: { json: wire('status.json') } });
    // The proof for the nonce the doctor sends: its first uuid without dashes.
    const nonce = '00000000000040009000000000000001';
    f.route({ method: 'GET', path: `/api/auth/proof?nonce=${nonce}`, reply: { json: { proof: proofFor(TOKEN, 4747, nonce) } } });
    expect(await f.run('doctor', '--json')).toBe(0);
    const { ok, checks } = JSON.parse(f.out());
    expect(ok).toBe(true);
    const by = Object.fromEntries(checks.map((c: { name: string }) => [c.name, c]));
    expect(by.server).toMatchObject({ level: 'ok', detail: 'Omni answers on http://127.0.0.1:4747' });
    expect(by.token).toMatchObject({ level: 'ok' });
    expect(by.token.detail).toContain('the server takes it');
    expect(by.log.lines).toBeUndefined();
  });

  it("says when the port answers as another install's Omni, or not as Omni", async () => {
    const other = fake({ ...install(), run: signedIn, routes: [{ method: 'GET', path: /^\/api\/auth\/proof/, reply: { json: { proof: 'not-ours' } } }] });
    expect(await other.run('doctor')).toBe(1);
    expect(other.out()).toMatch(/^FAIL\s+server\s+.*answers as Omni, but not with this token/m);
    // Whatever holds the port did not prove it has the token, so it never gets it.
    expect(other.out()).toMatch(/^ok\s+token\s+.*\(not sent: the server on that port is not this install\)$/m);
    expect(other.sent.map((s) => s.auth)).toEqual([undefined]);
    const stranger = fake({ ...install(), run: signedIn, routes: [{ method: 'GET', path: /^\/api\/auth\/proof/, reply: { status: 404, json: {} } }] });
    expect(await stranger.run('doctor')).toBe(1);
    expect(stranger.out()).toMatch(/^FAIL\s+server\s+.*answers, but not as Omni/m);
  });

  it('flags a missing token file, signed-out logins, a missing CLI and low disk', async () => {
    const base = install();
    const f = fake({
      ...base,
      files: { [LOG]: 'fine\n' },
      disk: { [DATA]: { free: 2 * 1024 ** 3, total: 500 * 1024 ** 3 } },
      run: (bin) => (bin === 'claude' ? { stdout: JSON.stringify({ loggedIn: false }) } : bin === 'codex' ? { code: 1, stdout: 'Not logged in' } : { missing: true }),
      routes: [{ method: 'GET', path: /^\/api\/auth\/proof/, reply: { refused: true } }],
    });
    expect(await f.run('doctor')).toBe(1);
    const out = f.out();
    expect(out).toMatch(/^FAIL\s+token\s+.*api-token \(the install\) does not exist/m);
    expect(out).toMatch(/^FAIL\s+disk\s+2.0 GB free of 500 GB .*Threads stop working when it fills.$/m);
    expect(out).toMatch(/^FAIL\s+claude\s+signed out/m);
    expect(out).toMatch(/^FAIL\s+codex\s+signed out: run codex login$/m);
    expect(out).toMatch(/^warn\s+gh\s+not installed/m);
  });

  it('says the app the command runs on is gone after the app moved', async () => {
    const { [APP]: _gone, ...stats } = install().stats;
    const f = fake({ ...install(), stats, run: signedIn, routes: [{ method: 'GET', path: /^\/api\/auth\/proof/, reply: { refused: true } }] });
    expect(await f.run('doctor')).toBe(1);
    expect(f.out()).toMatch(/^FAIL\s+omni\s+.*Omni.AppImage is gone/m);
  });

  it('warns about a token file other users can read', async () => {
    const base = install();
    const f = fake({ ...base, stats: { ...base.stats, [`${DATA}/api-token`]: { mode: 0o100644 } }, run: signedIn, routes: [{ method: 'GET', path: /^\/api\/auth\/proof/, reply: { refused: true } }] });
    await f.run('doctor');
    expect(f.out()).toMatch(/^warn\s+token\s+.*can be read by other users \(mode 644\)/m);
  });
});

