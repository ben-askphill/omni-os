// verifyMcpToken: which Clerk access tokens /mcp takes (PRD #667, S1). Pure: keys, userinfo and the client list are
// passed in, so this needs no db and no network.
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMcpToken, type ClientStatus, type VerifyInput } from '../mcp-token.ts';
import { fakeClerk, FAKE_ISSUER } from './fake-clerk.ts';

const clerk = fakeClerk();
const OWNER = { sub: 'user_owner' };
const RESOURCE = 'https://omni.example.com/mcp';

const input = (over: Partial<VerifyInput> & { statuses?: Record<string, ClientStatus> } = {}): VerifyInput => ({
  issuer: FAKE_ISSUER,
  ownerSub: OWNER.sub,
  resources: [RESOURCE, 'http://127.0.0.1:4747/mcp'],
  clientStatus: (id) => over.statuses?.[id] ?? null,
  allowOpaque: false,
  keyFor: async (kid) => (kid === 'key-1' ? clerk.jwk : null),
  userinfoSub: async (token) => (token.startsWith('revoked') ? null : OWNER.sub),
  ...over,
});

const nowS = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({ iss: FAKE_ISSUER, sub: OWNER.sub, client_id: 'client_claude', exp: nowS() + 600, ...extra });

describe('verifyMcpToken', () => {
  const table: [string, string, Partial<VerifyInput> & { statuses?: Record<string, ClientStatus> }, { ok: boolean; via?: string; kind?: string }][] = [
    ['own resource in aud', clerk.sign(claims({ aud: RESOURCE })), {}, { ok: true, via: 'audience' }],
    ['own resource with a trailing slash, in a list', clerk.sign(claims({ aud: ['other', `${RESOURCE}/`] })), {}, { ok: true, via: 'audience' }],
    ['approved client, no aud', clerk.sign(claims()), { statuses: { client_claude: 'approved' } }, { ok: true, via: 'client' }],
    ['foreign client, no aud', clerk.sign(claims({ client_id: 'client_evil' })), {}, { ok: false, kind: 'unbound' }],
    ['pending client, no aud', clerk.sign(claims()), { statuses: { client_claude: 'pending' } }, { ok: false, kind: 'unbound' }],
    ['wrong audience', clerk.sign(claims({ aud: 'https://other.example.com/mcp' })), {}, { ok: false, kind: 'unbound' }],
    ['removed client, even with our aud', clerk.sign(claims({ aud: RESOURCE })), { statuses: { client_claude: 'removed' } }, { ok: false, kind: 'removed' }],
    ['another user', clerk.sign(claims({ aud: RESOURCE, sub: 'user_eve' })), {}, { ok: false, kind: 'invalid' }],
    ['another issuer', clerk.sign(claims({ aud: RESOURCE, iss: 'https://evil.clerk.accounts.dev' })), {}, { ok: false, kind: 'invalid' }],
    ['expired', clerk.sign(claims({ aud: RESOURCE, exp: nowS() - 3600 })), {}, { ok: false, kind: 'invalid' }],
    ['unknown key id', clerk.sign(claims({ aud: RESOURCE }), { alg: 'RS256', kid: 'key-9' }), {}, { ok: false, kind: 'invalid' }],
    ['not RS256', clerk.sign(claims({ aud: RESOURCE }), { alg: 'none', kid: 'key-1' }), {}, { ok: false, kind: 'invalid' }],
    ['opaque token, opaque off', 'oat_0123456789abcdef', {}, { ok: false, kind: 'opaque' }],
    ['opaque token, opaque on', 'oat_0123456789abcdef', { allowOpaque: true }, { ok: true, via: 'opaque' }],
    ['opaque token Clerk refuses, opaque on', 'revoked_oat', { allowOpaque: true }, { ok: false, kind: 'invalid' }],
  ];

  it.each(table)('%s', async (_name, token, over, want) => {
    const v = await verifyMcpToken(token, input(over));
    expect(v.ok).toBe(want.ok);
    if (v.ok) expect(v.via).toBe(want.via);
    else expect(v.kind).toBe(want.kind);
  });

  it('refuses a token signed by another key under our kid', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = clerk.sign(claims({ aud: RESOURCE }), { alg: 'RS256', kid: 'key-1' }, privateKey);
    expect(await verifyMcpToken(forged, input())).toMatchObject({ ok: false, kind: 'invalid', reason: expect.stringMatching(/signature/) });
  });

  it('refuses a JWT Clerk revoked since it was signed', async () => {
    const token = clerk.sign(claims({ aud: RESOURCE }));
    const v = await verifyMcpToken(token, input({ userinfoSub: async () => null }));
    expect(v).toMatchObject({ ok: false, kind: 'invalid' });
  });

  it('names the client in an unbound refusal, so the user knows what to approve', async () => {
    const v = await verifyMcpToken(clerk.sign(claims({ client_id: 'client_evil' })), input());
    expect(v).toMatchObject({ ok: false, client: 'client_evil', reason: expect.stringMatching(/client_evil is not approved/) });
  });
});
