import { describe, expect, it } from 'vitest';
import { clean, parseClaudeStatus, parseCodexAccount, parseCursorAbout, parseCursorMe, planName, sanitize } from '../harness/accounts-parse.ts';

// The account checks' parsers, on output shaped as each CLI printed it on a real machine (claude 2.1.316, codex-cli
// 0.166.0, cursor-agent 2026.11.13), with the identities swapped for test ones. None returns a field it did not
// pick, and none returns a string shaped like a credential.

const JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImJlbkBleGFtcGxlLmNvbSJ9.c2lnbmF0dXJlc2lnbmF0dXJl';
const TOKENS = ['sk-ant-oat01-abcdefghijklmnopqrstuvwx', 'sk-proj-abcdefghijklmnopqrstuvwx', JWT, 'key_0123456789abcdef0123456789abcdef', 'crsr_abcdefghijklmnop'];

const noToken = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const t of TOKENS) expect(s).not.toContain(t);
};

describe('clean', () => {
  it('keeps an email, a name and an org', () => {
    expect(clean('ben@example.com')).toBe('ben@example.com');
    expect(clean("  ben@example.com's\n Organization ")).toBe("ben@example.com's Organization");
    expect(clean('Ask Phill')).toBe('Ask Phill');
  });

  it('keeps ordinary text that holds a key prefix inside a word', () => {
    expect(clean('risk-analytics@acme.com')).toBe('risk-analytics@acme.com');
    expect(clean('Helpdesk-Operations')).toBe('Helpdesk-Operations');
    expect(clean('monkey_business@example.com')).toBe('monkey_business@example.com');
  });

  it('drops anything shaped like a credential, whole or inside a longer string', () => {
    for (const t of TOKENS) {
      expect(clean(t)).toBeNull();
      expect(clean(`token: ${t}`)).toBeNull();
    }
    expect(clean('Bearer abcdefghijklmnopqrstuvwxyz')).toBeNull();
    expect(clean('user-sk-ant-oat01-abcdefghijklmnop')).toBeNull();
    expect(clean('A'.repeat(48))).toBeNull();
  });

  it('drops a non-string and cuts a long one', () => {
    expect(clean(42)).toBeNull();
    expect(clean({ email: 'a@b.c' })).toBeNull();
    expect(clean('word '.repeat(60), 20)).toHaveLength(20);
  });
});

describe('planName', () => {
  it('names a plan as the harness would say it', () => {
    expect(planName('max')).toBe('Max');
    expect(planName('team')).toBe('Team');
    expect(planName('claude_max')).toBe('Max');
    expect(planName('plus')).toBe('Plus');
    expect(planName(null)).toBeNull();
  });
});

describe('Claude Code: claude auth status --json', () => {
  const status = {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    analyticsDisabled: false,
    projectsDirectory: '/home/ben/.claude/projects',
    configDirectory: '/home/ben/.claude',
    email: 'ben@example.com',
    orgId: '0b0c3a6e-0000-4000-8000-000000000000',
    orgName: 'Acme',
    subscriptionType: 'team',
  };

  it('reads the email, org and plan, and nothing else', () => {
    const a = parseClaudeStatus(JSON.stringify(status));
    expect(a).toEqual({ harness: 'claude-code', state: 'signed-in', label: 'ben@example.com', org: 'Acme', plan: 'Team', note: null, switched: null });
    expect(JSON.stringify(a)).not.toContain(status.orgId);
  });

  it('says signed out, and unknown when the output is not its JSON', () => {
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: false })).state).toBe('signed-out');
    expect(parseClaudeStatus('error: unknown command auth').state).toBe('unknown');
    expect(parseClaudeStatus('').state).toBe('unknown');
  });

  it('says when it bills an API key or another provider, not a plan', () => {
    expect(parseClaudeStatus(JSON.stringify({ ...status, authMethod: 'api_key', subscriptionType: null })).note).toBe('API key');
    expect(parseClaudeStatus(JSON.stringify({ ...status, apiProvider: 'bedrock' })).note).toBe('bedrock');
  });

  it('leaves out every token field, and an email shaped like one', () => {
    const extra = { ...status, accessToken: TOKENS[0], refreshToken: TOKENS[0], oauthAccount: { token: JWT } };
    noToken(parseClaudeStatus(JSON.stringify(extra)));
    expect(parseClaudeStatus(JSON.stringify({ ...status, email: TOKENS[0] }))).toMatchObject({ state: 'unknown', label: null });
  });
});

describe('Codex: account/read', () => {
  it('reads the email, plan and a workspace that is not Personal', () => {
    expect(parseCodexAccount({ account: { type: 'chatgpt', email: 'ben@example.com', planType: 'plus', workspaceName: 'Personal' } })).toMatchObject({
      state: 'signed-in',
      label: 'ben@example.com',
      plan: 'Plus',
      org: null,
    });
    expect(parseCodexAccount({ account: { type: 'chatgpt', email: 'ben@example.com', planType: 'team', workspaceName: 'Acme' } }).org).toBe('Acme');
  });

  it('reads an API key login as signed out of the plan, and no account as signed out', () => {
    expect(parseCodexAccount({ account: { type: 'apiKey' } })).toMatchObject({ state: 'signed-out', label: null });
    expect(parseCodexAccount({ account: null }).state).toBe('signed-out');
    expect(parseCodexAccount({}).state).toBe('unknown');
    expect(parseCodexAccount(null).state).toBe('unknown');
  });

  it('leaves out anything else the answer carries', () => {
    noToken(parseCodexAccount({ account: { type: 'chatgpt', email: 'ben@example.com', planType: 'plus', id_token: JWT, access_token: TOKENS[1] }, tokens: { refresh: TOKENS[1] } }));
  });
});

describe('Cursor Agent: cursor-agent about --format json', () => {
  it('reads the email and tier', () => {
    const about = { cliVersion: '2026.11.13-eacade1', model: 'Composer 2.5', subscriptionTier: 'Premium', userEmail: 'ben@example.com', lastRequestId: 'abc' };
    expect(parseCursorAbout(JSON.stringify(about))).toMatchObject({ state: 'signed-in', label: 'ben@example.com', plan: 'Premium' });
  });

  it('reads "Not logged in" as signed out, and an unknown tier as none', () => {
    expect(parseCursorAbout(JSON.stringify({ userEmail: 'Not logged in', subscriptionTier: 'Unknown' })).state).toBe('signed-out');
    expect(parseCursorAbout(JSON.stringify({ userEmail: 'ben@example.com', subscriptionTier: 'Unknown' })).plan).toBeNull();
    expect(parseCursorAbout('Not logged in').state).toBe('unknown');
  });

  it('leaves out the tokens', () => {
    noToken(parseCursorAbout(JSON.stringify({ userEmail: 'ben@example.com', accessToken: JWT, apiKey: TOKENS[3] })));
  });
});

describe('Cursor Cloud: GET /v1/me', () => {
  it('reads the email the key belongs to and names the key', () => {
    const me = { apiKeyName: 'omni-os', userId: 1, createdAt: '2026-10-07T08:59:57.573Z', userEmail: 'ben@example.com', userFirstName: 'Ben', userLastName: 'Example' };
    expect(parseCursorMe(me)).toMatchObject({ harness: 'cursor-cloud', state: 'signed-in', label: 'ben@example.com', note: 'Key omni-os' });
    expect(parseCursorMe({ userFirstName: 'Ben', userLastName: 'Example' }).label).toBe('Ben Example');
    expect(parseCursorMe({}).state).toBe('unknown');
  });
});

describe('sanitize: a record another machine wrote', () => {
  it('keeps only the known fields, cleaned, and reads a bad state as unknown', () => {
    const a = sanitize({ state: 'signed-in', label: 'ben@example.com', org: 'Acme', plan: 'Max', note: null, token: TOKENS[0], last: { label: 'a@example.com', org: null, plan: null, secret: JWT } }, 'claude-code');
    expect(a).toEqual({ harness: 'claude-code', state: 'signed-in', label: 'ben@example.com', org: 'Acme', plan: 'Max', note: null, switched: null, last: { label: 'a@example.com', org: null, plan: null } });
    expect(sanitize({ state: 'hacked', label: 'x' }, 'codex').state).toBe('unknown');
    expect(sanitize({ state: 'signed-in', label: TOKENS[2] }, 'codex')).toMatchObject({ state: 'unknown', label: null });
    expect(sanitize({ state: 'signed-in', label: 'b@example.com', switched: { from: { label: 'a@example.com' }, at: 'not a time' } }, 'codex').switched).toBeNull();
  });
});
