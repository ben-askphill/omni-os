// decideRequest: which requests may act (PRD #667, S8, S12, S14, S18). Pure: facts in, allow or refuse with why out.
import { describe, expect, it } from 'vitest';
import { decideRequest, type Credential, type RequestFacts, type RouteClass } from '../request-trust.ts';

const base: RequestFacts = { method: 'GET', route: 'read', hostAllowed: true, hosts: ['127.0.0.1:4747'], originAllowed: false, credential: 'token', open: false };
const decide = (over: Partial<RequestFacts>) => decideRequest({ ...base, ...over });
const SITES = [undefined, 'none', 'same-origin', 'same-site', 'cross-site'] as const;
const CREDS: Credential[] = ['token', 'session-token', 'session', 'nonce', 'none'];
const ROUTES: RouteClass[] = ['read', 'act', 'terminal', 'pairing'];

/** The rule, written out once more as a table key, to check every combination against. */
function expected(route: RouteClass, site: (typeof SITES)[number], cred: Credential): boolean {
  if (site === 'same-site' || site === 'cross-site') return false;
  if (route === 'pairing') return (site === undefined || site === 'none') && (cred === 'nonce' || cred === 'token');
  if (cred === 'none') return false;
  if (route === 'terminal') return cred === 'token' || cred === 'session-token';
  return true;
}

describe('decideRequest', () => {
  for (const route of ROUTES)
    for (const site of SITES)
      for (const credential of CREDS)
        it(`${route}, Sec-Fetch-Site ${site ?? 'absent'}, ${credential}`, () => {
          expect(decide({ route, fetchSite: site, credential, method: route === 'act' ? 'POST' : 'GET' }).ok).toBe(expected(route, site, credential));
        });

  it('treats a page on another port of this host as foreign (S14)', () => {
    expect(decide({ fetchSite: 'same-site' })).toEqual({ ok: false, status: 403, reason: 'request from another site or port on this host' });
  });

  it('takes an Origin only when it is the Host the request came in on', () => {
    expect(decide({ origin: 'http://127.0.0.1:4747', originAllowed: true }).ok).toBe(true);
    expect(decide({ origin: 'http://127.0.0.1:3000', originAllowed: true }).ok).toBe(false);
    expect(decide({ origin: 'null', originAllowed: false }).ok).toBe(false);
    expect(decide({ origin: 'https://evil.example', originAllowed: false }).ok).toBe(false);
    // tailscale serve names the original Host in X-Forwarded-Host.
    expect(decide({ origin: 'https://mac.tail1.ts.net', originAllowed: true, hosts: ['127.0.0.1:4747', 'mac.tail1.ts.net'] }).ok).toBe(true);
  });

  it('refuses a body type that skips the preflight, a host it does not answer to, and no credential on a closed route', () => {
    expect(decide({ method: 'POST', route: 'act', contentType: 'text/plain;charset=utf-8' })).toMatchObject({ ok: false, status: 415 });
    expect(decide({ hostAllowed: false })).toMatchObject({ ok: false, status: 403, reason: 'host not allowed' });
    expect(decide({ credential: 'none' })).toMatchObject({ ok: false, status: 401 });
    expect(decide({ credential: 'none', open: true }).ok).toBe(true);
  });
});
