import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The Web UI shell (the build's index.html, for `/` and every client route) gets a CSP, report-only for now, with
// the inline theme script by hash, an enforced clickjacking guard, nosniff and a referrer policy (web-headers.ts).
// /api keeps its own headers, so the artifact frames still load. Violations post to /api/csp-report (report-uri), which
// counts them and keeps no address that could carry a token or a key.

const THEME = `
      try { document.documentElement.dataset.theme = 'dark'; } catch (e) {}
    `;
const page = (script: string) =>
  `<!doctype html><html><head><script>${script}</script><title>Omni</title><script type="module" crossorigin src="/assets/app.js"></script></head><body></body></html>`;
const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

const web = mkdtempSync(join(tmpdir(), 'omni-web-'));
mkdirSync(join(web, 'assets'));
writeFileSync(join(web, 'index.html'), page(THEME));
writeFileSync(join(web, 'assets', 'app.js'), 'console.log("omni")');
afterAll(() => rmSync(web, { recursive: true, force: true }));

const r = await startRunner({ OMNI_WEB_DIST: web });
const { app } = await import('../app.ts');
const { resetCspReports } = await import('../csp-report-api.ts');

const policy = (hash: string) =>
  `script-src 'self' ${hash} 'report-sample'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-uri /api/csp-report`;

describe('the Web UI shell', () => {
  it('sends a report-only CSP with the inline script by hash, and enforces the frame guard, nosniff and referrer policy', async () => {
    for (const path of ['/', '/index.html', '/c/inbox', '/t/abc/details']) {
      const res = await app.request(path);
      expect(res.headers.get('content-type'), path).toContain('text/html');
      expect(res.headers.get('content-security-policy-report-only'), path).toBe(policy(sha(THEME)));
      expect(res.headers.get('content-security-policy'), path).toBe("frame-ancestors 'none'");
      expect(res.headers.get('x-frame-options'), path).toBe('DENY');
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(res.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
    }
    expect(policy(sha(THEME))).not.toContain('unsafe-inline');
  });

  it("gives the build's scripts and styles nosniff and no page policy", async () => {
    const res = await app.request('/assets/app.js');
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    for (const name of ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options']) {
      expect(res.headers.get(name), name).toBeNull();
    }
  });

  it('hashes the inline script of a rebuilt index.html without a restart', async () => {
    const next = "document.documentElement.dataset.theme='light'";
    writeFileSync(join(web, 'index.html'), page(next));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(web, 'index.html'), later, later);
    try {
      for (const path of ['/', '/c/inbox']) {
        expect((await app.request(path)).headers.get('content-security-policy-report-only'), path).toBe(policy(sha(next)));
      }
    } finally {
      writeFileSync(join(web, 'index.html'), page(THEME));
    }
  });

  it('leaves /api alone, so an artifact keeps its sandbox and still loads in the Web UI frames', async () => {
    const thread = r.db.threads.create({
      id: randomUUID(), channel_id: 'scratch', title: 'T', status: 'done', role: null, model: null, session_id: randomUUID(),
      cwd: r.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });
    const dir = join(r.paths.threads, thread.id, 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.html'), '<!doctype html><title>Q3</title>');
    const a = r.db.artifacts.upsert({ thread_id: thread.id, path: join(dir, 'report.html'), name: 'report.html', kind: 'html', size: 31 });
    for (const path of [`/api/artifacts/${a.id}/raw`, `/api/artifacts/${a.id}/raw?frame=1`, '/api/status', '/api/nope']) {
      const res = await app.request(path);
      expect(res.headers.get('x-frame-options'), path).toBeNull();
      expect(res.headers.get('content-security-policy-report-only'), path).toBeNull();
      expect(res.headers.get('content-security-policy') ?? '', path).not.toContain('frame-ancestors');
    }
    const raw = await app.request(`/api/artifacts/${a.id}/raw`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
  });
});

describe('/api/csp-report', () => {
  const NONE = { authorization: '' };
  const post = (body: unknown, type = 'application/reports+json', headers: Record<string, string> = {}) =>
    app.request('http://127.0.0.1:4747/api/csp-report', {
      method: 'POST',
      headers: { ...NONE, host: '127.0.0.1:4747', origin: 'http://127.0.0.1:4747', 'content-type': type, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const counts = async () =>
    (await (await app.request('/api/csp-report')).json()) as {
      total: number;
      dropped: number;
      violations: { directive: string; blocked: string; source: string; line: number | null; sample: string; count: number; disposition: string }[];
    };
  const violation = (body: Record<string, unknown>) => ({ type: 'csp-violation', age: 0, url: 'http://127.0.0.1:4747/?pair=omni_secret_pair', user_agent: 'x', body });

  beforeEach(() => resetCspReports());

  it('takes a report from the browser without a token, and counts it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = violation({
      documentURL: 'http://127.0.0.1:4747/?pair=omni_secret_pair',
      blockedURL: 'inline',
      effectiveDirective: 'script-src-elem',
      sourceFile: 'http://127.0.0.1:4747/api/k/0123456789abcdef0123456789abcdef/threads?token=omni_secret_q#frag',
      lineNumber: 12,
      columnNumber: 3,
      sample: 'alert(1)',
      disposition: 'report',
    });
    expect((await post([one, one])).status).toBe(204);
    expect((await post([one])).status).toBe(204);
    const got = await counts();
    expect(got).toMatchObject({ total: 3, dropped: 0 });
    expect(got.violations).toEqual([
      expect.objectContaining({ directive: 'script-src-elem', blocked: 'inline', source: '/api/k/…/threads', line: 12, sample: 'alert(1)', count: 3, disposition: 'report' }),
    ]);
    // Logged once, on first sight, and nothing that could carry a token or a key reached the log or the counts.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('[csp] report script-src-elem blocked inline at /api/k/…/threads:12');
    for (const text of [logged, JSON.stringify(got)]) {
      for (const secret of ['omni_secret', 'pair=', '0123456789abcdef', 'frag', 'documentURL']) expect(text).not.toContain(secret);
    }
    warn.mockRestore();
  });

  it("keeps another origin's URL as its origin only, and reads the older report-uri shape", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await post([violation({ blockedURL: 'https://evil.example/x.js?k=omni_secret', effectiveDirective: 'script-src-elem', disposition: 'report' })]);
    const legacy = {
      'csp-report': {
        'document-uri': 'http://127.0.0.1:4747/?pair=omni_secret_pair',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'eval',
        'source-file': 'http://127.0.0.1:4747/assets/index-abc.js',
        'line-number': 7,
        disposition: 'report',
      },
    };
    // What Chromium and Electron send for report-uri: no cookie or token, this origin, same-origin, no-cors.
    expect((await post(legacy, 'application/csp-report', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors' })).status).toBe(204);
    const got = await counts();
    expect(got.violations.map((v) => [v.blocked, v.source])).toEqual(expect.arrayContaining([['https://evil.example', ''], ['eval', '/assets/index-abc.js']]));
    expect(JSON.stringify(got)).not.toContain('omni_secret');
    warn.mockRestore();
  });

  it('refuses what is not a report, and reads the counts only with a token', async () => {
    expect((await post('not json', 'application/json')).status).toBe(400);
    expect((await post({ hello: 1 }, 'application/json')).status).toBe(400);
    expect((await post('x', 'text/plain')).status).toBe(415);
    expect((await post('[]', 'application/xml')).status).toBe(415);
    expect((await post(`[${'1,'.repeat(40_000)}1]`)).status).toBe(413);
    // A page on another site cannot post one through a browser.
    expect((await post([], 'application/reports+json', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await app.request('/api/csp-report', { headers: NONE })).status).toBe(401);
    expect((await counts()).total).toBe(0);
  });

  it('is open only straight from this machine: through a proxy or the Connect tunnel a report needs a session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = [violation({ blockedURL: 'inline', effectiveDirective: 'script-src-elem', disposition: 'report' })];
    const proxies: Record<string, string>[] = [{ 'x-forwarded-for': '203.0.113.9' }, { host: 'mac.tail1234.ts.net', origin: 'https://mac.tail1234.ts.net' }];
    for (const proxied of proxies) {
      expect((await post(one, 'application/reports+json', proxied)).status, JSON.stringify(proxied)).toBe(401);
    }
    expect((await counts()).total).toBe(0);
    // The browser's session cookie sits on /api over HTTPS and goes with the report; the token works too.
    const TOKEN = process.env.OMNI_TOKEN!;
    expect((await post(one, 'application/reports+json', { 'x-forwarded-for': '203.0.113.9', authorization: `Bearer ${TOKEN}` })).status).toBe(204);
    expect((await counts()).total).toBe(1);
    warn.mockRestore();
  });

  it('keeps at most 50 distinct violations, and counts the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: 50 }, (_, i) => violation({ blockedURL: 'inline', effectiveDirective: 'script-src-elem', lineNumber: i }));
    await post(many);
    await post([violation({ blockedURL: 'inline', effectiveDirective: 'script-src-elem', lineNumber: 999 })]);
    const got = await counts();
    expect(got).toMatchObject({ total: 51, dropped: 1 });
    expect(got.violations).toHaveLength(50);
    // One line per kept violation, and one saying the cap is reached, so a flood cannot hide what follows it unseen.
    expect(warn).toHaveBeenCalledTimes(51);
    expect(String(warn.mock.calls[50][0])).toContain('50 distinct violations kept');
    warn.mockRestore();
  });
});
