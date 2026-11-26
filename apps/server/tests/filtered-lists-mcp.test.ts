import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { callOver } from '@omni/mcp/external/tools.ts';
import { mcpHttp } from '@omni/mcp/external/http.ts';
import { OmniMcp } from './omni-mcp.ts';

// End-to-end verification of filtering and compact defaults (#1009) for list_pull_requests, list_skills and
// tool_failures across the Conductor MCP server (apps/mcp/omni.ts) and list_pull_requests on the external MCP server
// (apps/mcp/external/tools.ts), seeded at the context-token audit's scale (345 PRs: 29 open / 309 merged / 7 closed;
// 476 skills with full multi-sentence descriptions; 156 tool-failure groups with ~33K of guidance prose).

// ---------- audit-scale fixture data ----------

const channelRepos: Record<string, string | null> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`channel-${String(i + 1).padStart(2, '0')}`, `org/project-repo-${i + 1}`])),
  'channel-norepo': null,
};

const allPrs = [
  // 29 open PRs (3 drafts + 26 open)
  ...Array.from({ length: 29 }, (_, i) => ({
    repo: `org/project-repo-${(i % 10) + 1}`,
    number: 900 - i,
    title: `feat: implement improvement #${900 - i} across module ${(i % 12) + 1}`,
    author: i % 7 === 0 ? null : { login: `dev-${(i % 5) + 1}` },
    state: 'OPEN',
    isDraft: i < 3,
    labels: i % 4 === 0 ? ['enhancement', 'priority'] : [],
    url: `https://github.com/org/project-repo-${(i % 10) + 1}/pull/${900 - i}`,
    updatedAt: `2026-11-${String((i % 25) + 1).padStart(2, '0')}T12:00:00.000Z`,
    headRefName: `feat/open-${900 - i}`,
  })),
  // 309 merged PRs
  ...Array.from({ length: 309 }, (_, i) => ({
    repo: `org/project-repo-${(i % 10) + 1}`,
    number: 800 - i,
    title: `fix: ship historical change #${800 - i} for service ${(i % 10) + 1}`,
    author: { login: `dev-${(i % 5) + 1}` },
    state: 'MERGED',
    isDraft: false,
    labels: i % 5 === 0 ? ['shipped'] : [],
    url: `https://github.com/org/project-repo-${(i % 10) + 1}/pull/${800 - i}`,
    updatedAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
    headRefName: `fix/merged-${800 - i}`,
  })),
  // 7 closed PRs
  ...Array.from({ length: 7 }, (_, i) => ({
    repo: `org/project-repo-${(i % 10) + 1}`,
    number: 400 - i,
    title: `chore: abandoned experiment #${400 - i}`,
    author: { login: `dev-${(i % 5) + 1}` },
    state: 'CLOSED',
    isDraft: false,
    labels: ['wontfix'],
    url: `https://github.com/org/project-repo-${(i % 10) + 1}/pull/${400 - i}`,
    updatedAt: `2026-09-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`,
    headRefName: `chore/closed-${400 - i}`,
  })),
];

const skillsFixture = Array.from({ length: 476 }, (_, i) => {
  const isSpecial = i === 42;
  const name = isSpecial ? 'shopify-catalog-sync' : `skill-${String(i + 1).padStart(3, '0')}`;
  const description = isSpecial
    ? 'Synchronize catalog records between headless storefronts and upstream commerce APIs.\n\nUse whenever updating metafields, verifying translation keys, or triggering webhook-needle-token backfill runs across storefronts.'
    : `Comprehensive workflow skill #${i + 1} for automating repeatable tasks across workspaces.\nUse this skill whenever the user asks to configure, audit, troubleshoot, or migrate module ${i + 1} with validation checks, structured outputs, and rollback safety across every supported harness and environment.`;
  return {
    name,
    description,
    source: i % 3 === 0 ? 'plugin' : 'personal',
    ...(i % 3 === 0 && { plugin: isSpecial ? 'commerce-pack' : `pack-${(i % 8) + 1}` }),
    harnesses: i % 2 === 0 ? ['claude-code', 'codex', 'cursor'] : ['claude-code'],
  };
});

const repoSkill = {
  name: 'repo-only-deploy',
  description: 'Deploy the repository preview stack and verify health endpoints.\nIncludes rollback checks.',
  source: 'project',
  harnesses: ['claude-code', 'codex'],
};

const groupId = (i: number) => String(i + 1).padStart(64, '0');
const failureGroups = Array.from({ length: 156 }, (_, i) => {
  const hasGuidance = i < 52;
  const statuses = ['open', 'investigating', 'avoid', 'replacement', 'fixed'] as const;
  return {
    group_id: groupId(i),
    harness: i % 3 === 0 ? 'claude-code' : i % 3 === 1 ? 'codex' : 'cursor',
    tool: `mcp__service_${(i % 12) + 1}__action_${(i % 15) + 1}`,
    category: i % 2 === 0 ? 'invalid_input' : 'not_found',
    detail: i % 2 === 0 ? 'Invalid tool input.' : 'Requested resource not found.',
    occurrences: 200 - i,
    first_seen: '2026-10-01T08:00:00.000Z',
    last_seen: '2026-11-26T08:00:00.000Z',
    status: i < 10 ? 'open' : statuses[i % statuses.length],
    guidance: hasGuidance
      ? `Avoid passing unquoted paths or stale identifiers for action ${(i % 15) + 1}. ` +
        `First verify the target identifier with the lookup tool, check workspace bounds, and retry once with normalized arguments. ` +
        `If the upstream service rejects the schema a second time, fall back to the documented batch endpoint and record the observed recovery status on the occurrence row. `.repeat(2)
      : '',
    updated_at: '2026-11-26T08:00:00.000Z',
  };
});

const topGroupOccurrences = Array.from({ length: 35 }, (_, i) => ({
  cursor: 1000 - i,
  id: String(5000 + i).padStart(64, '0'),
  group_id: groupId(0),
  thread_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  channel_id: 'omni-os',
  harness: 'claude-code',
  session_id: `sess-${i + 1}`,
  call_id: `call-${i + 1}`,
  tool: failureGroups[0].tool,
  category: failureGroups[0].category,
  detail: failureGroups[0].detail,
  event_id: 200 + i,
  parent_call_id: null,
  recovery: 'unknown',
  retry_of: null,
  created_at: `2026-11-26T07:${String(59 - i).padStart(2, '0')}:00.000Z`,
}));

function answer(method: string, rawUrl: string, rawBody = ''): [number, unknown] {
  const u = new URL(rawUrl, 'http://127.0.0.1');
  const path = u.pathname;

  if (method === 'GET' && path === '/api/prs') {
    const ch = u.searchParams.get('channel');
    if (ch) {
      if (!(ch in channelRepos)) return [404, { error: 'No channel with this id.' }];
      const repo = channelRepos[ch];
      if (!repo) return [200, { repos: [], prs: [], failed: [], viewer: null }];
      return [200, { repos: [repo], prs: allPrs.filter((p) => p.repo === repo), failed: [], viewer: 'dev-1' }];
    }
    return [200, { repos: Object.values(channelRepos).filter(Boolean), prs: allPrs, failed: [], viewer: 'dev-1' }];
  }

  if (method === 'GET' && path === '/api/skills') {
    const ch = u.searchParams.get('channel');
    const skills = ch === 'channel-01' ? [...skillsFixture, repoSkill] : skillsFixture;
    const loading = ch === 'channel-loading' ? ['codex'] : [];
    return [200, { skills, listed: ['claude-code', 'codex', 'cursor'], loading }];
  }

  if (method === 'GET' && path === '/api/tool-failures') {
    const status = u.searchParams.get('status');
    const rows = status ? failureGroups.filter((g) => g.status === status) : failureGroups;
    return [200, rows];
  }

  const groupMatch = /^\/api\/tool-failures\/([a-f0-9]{64})$/.exec(path);
  if (groupMatch && method === 'GET') {
    const hit = failureGroups.find((g) => g.group_id === groupMatch[1]);
    return hit ? [200, hit] : [404, { error: 'not found' }];
  }
  if (groupMatch && method === 'PATCH') {
    const hit = failureGroups.find((g) => g.group_id === groupMatch[1]);
    if (!hit) return [404, { error: 'not found' }];
    const patch = JSON.parse(rawBody || '{}');
    hit.status = patch.status;
    hit.guidance = patch.guidance;
    return [200, { ok: true }];
  }

  const occMatch = /^\/api\/tool-failures\/([a-f0-9]{64})\/occurrences$/.exec(path);
  if (occMatch && method === 'GET') {
    const before = u.searchParams.get('before') ? Number(u.searchParams.get('before')) : Number.MAX_SAFE_INTEGER;
    const rows = occMatch[1] === groupId(0) ? topGroupOccurrences.filter((o) => o.cursor < before) : [];
    return [200, rows];
  }

  return [404, { error: `no fake for ${method} ${rawUrl}` }];
}

let api: Server;
let omni: OmniMcp;
let extHandler: (req: Request) => Promise<Response>;

const callOmni = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await omni.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  expect(r.isError, `${name} returned error: ${r.content[0]?.text}`).toBeFalsy();
  const raw = r.content[0].text;
  return { raw, body: JSON.parse(raw) };
};

let rpcId = 0;
const callExternal = async (name: string, args: Record<string, unknown> = {}) => {
  const req = new Request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = await extHandler(req);
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  expect(result.isError).toBeFalsy();
  const raw = result.content[0].text;
  return { raw, body: JSON.parse(raw) };
};

beforeAll(async () => {
  api = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const [status, body] = answer(req.method!, req.url!, Buffer.concat(chunks).toString('utf8'));
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  omni = await OmniMcp.start({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben', OMNI_THREAD_ID: 'conductor-thread' });
  await omni.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  const call = callOver(async (path, init) => {
    const [status, body] = answer(init.method ?? 'GET', path, typeof init.body === 'string' ? init.body : '');
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  extHandler = mcpHttp(call);
}, 30_000);

afterAll(() => {
  omni?.close();
  api?.close();
});

const T = { timeout: 30_000 };

describe('filtered list tools at audit scale (#1009)', () => {
  it('list_pull_requests defaults to open PRs under 8K chars and supports state, channel and limit on Conductor and external MCP', T, async () => {
    const def = await callOmni('list_pull_requests');
    expect(def.body.prs).toHaveLength(29);
    expect(def.body.prs.every((p: any) => p.state === 'OPEN' || p.state === 'DRAFT')).toBe(true);
    expect(def.body.prs.filter((p: any) => p.state === 'DRAFT')).toHaveLength(3);
    expect(def.body).not.toHaveProperty('total');
    expect(def.raw.length).toBeLessThan(8_000);

    // External MCP gets the exact same default open-only budget and filters.
    const extDef = await callExternal('list_pull_requests');
    expect(extDef.raw).toBe(def.raw);
    expect(extDef.raw.length).toBeLessThan(8_000);

    // Merged and closed PRs are reachable by state, bounded by limit with total reported.
    const merged = await callOmni('list_pull_requests', { state: 'merged', limit: 5 });
    expect(merged.body.prs).toHaveLength(5);
    expect(merged.body.total).toBe(309);
    expect(merged.body.prs.every((p: any) => p.state === 'MERGED')).toBe(true);

    const closed = await callOmni('list_pull_requests', { state: 'closed' });
    expect(closed.body.prs).toHaveLength(7);
    expect(closed.body.prs.every((p: any) => p.state === 'CLOSED')).toBe(true);
    expect(closed.body).not.toHaveProperty('total');

    const drafts = await callOmni('list_pull_requests', { state: 'draft' });
    expect(drafts.body.prs).toHaveLength(3);
    expect(drafts.body.prs.every((p: any) => p.state === 'DRAFT')).toBe(true);

    const all = await callOmni('list_pull_requests', { state: 'all', limit: 40 });
    expect(all.body.prs).toHaveLength(40);
    expect(all.body.total).toBe(345);
    expect(all.body.prs[0].state).toMatch(/OPEN|DRAFT/);
    expect(all.body.prs[29].state).toBe('MERGED');

    // Channel narrows to one channel's repo on both Conductor and external MCP.
    const ch = await callOmni('list_pull_requests', { channel: 'channel-01', state: 'all', limit: 100 });
    expect(ch.body.prs.length).toBeGreaterThan(0);
    expect(ch.body.prs.every((p: any) => p.repo === 'org/project-repo-1')).toBe(true);

    const extCh = await callExternal('list_pull_requests', { channel: 'channel-01', state: 'open' });
    expect(extCh.body.prs.every((p: any) => p.repo === 'org/project-repo-1' && (p.state === 'OPEN' || p.state === 'DRAFT'))).toBe(true);

    const noRepo = await callOmni('list_pull_requests', { channel: 'channel-norepo' });
    expect(noRepo.body).toEqual({ prs: [], failed: [] });
  });

  it('list_skills returns compact name + one-line description rows at 476 skills and narrows with query and limit', T, async () => {
    const def = await callOmni('list_skills');
    expect(def.body.skills).toHaveLength(50);
    expect(def.body.total).toBe(476);
    expect(def.raw.length).toBeLessThan(10_000);
    for (const s of def.body.skills) {
      expect(Object.keys(s).sort()).toEqual(['description', 'name']);
      expect(s.description).not.toContain('\n');
      expect(s.description.length).toBeLessThanOrEqual(120);
    }

    // query matches words in name, plugin, AND beyond char 120 of the original description.
    const byName = await callOmni('list_skills', { query: 'shopify' });
    expect(byName.body.skills.map((s: any) => s.name)).toEqual(['shopify-catalog-sync']);
    expect(byName.body).not.toHaveProperty('total');

    const byLateDesc = await callOmni('list_skills', { query: 'webhook-needle-token' });
    expect(byLateDesc.body.skills.map((s: any) => s.name)).toEqual(['shopify-catalog-sync']);

    const byPlugin = await callOmni('list_skills', { query: 'commerce-pack' });
    expect(byPlugin.body.skills.map((s: any) => s.name)).toEqual(['shopify-catalog-sync']);

    // limit caps or widens the list.
    const small = await callOmni('list_skills', { limit: 5 });
    expect(small.body.skills).toHaveLength(5);
    expect(small.body.total).toBe(476);

    const full = await callOmni('list_skills', { limit: 500 });
    expect(full.body.skills).toHaveLength(476);
    expect(full.body).not.toHaveProperty('total');

    // channel includes project skills and still_loading passes through.
    const repo = await callOmni('list_skills', { channel: 'channel-01', query: 'repo-only-deploy' });
    expect(repo.body.skills.map((s: any) => s.name)).toEqual(['repo-only-deploy']);

    const loading = await callOmni('list_skills', { channel: 'channel-loading', limit: 3 });
    expect(loading.body.still_loading).toEqual(['codex']);
  });

  it('tool_failures omits guidance prose by default, filters by status/limit, returns one group guidance on group_id, and supports triage flow', T, async () => {
    const def = await callOmni('tool_failures');
    expect(def.body.groups).toHaveLength(20);
    expect(def.body.total).toBe(156);
    expect(def.raw.length).toBeLessThan(8_000);
    for (const g of def.body.groups) {
      expect(g).not.toHaveProperty('guidance');
      expect(g.has_guidance).toBe(true);
    }

    // Filter by status and cap with limit.
    const open = await callOmni('tool_failures', { status: 'open', limit: 5 });
    expect(open.body.groups).toHaveLength(5);
    expect(open.body.groups.every((g: any) => g.status === 'open')).toBe(true);
    expect(open.body.total).toBeGreaterThan(5);

    // Groups without guidance omit has_guidance (compactRow drops false).
    const allGroups = await callOmni('tool_failures', { limit: 200 });
    expect(allGroups.body.groups).toHaveLength(156);
    expect(allGroups.body).not.toHaveProperty('total');
    const withoutGuidance = allGroups.body.groups.find((g: any) => g.group_id === groupId(100));
    expect(withoutGuidance).not.toHaveProperty('has_guidance');
    expect(withoutGuidance).not.toHaveProperty('guidance');

    // Requesting one group returns its full guidance and bounded recent occurrences.
    const one = await callOmni('tool_failures', { group_id: groupId(0) });
    expect(one.body.group.group_id).toBe(groupId(0));
    expect(one.body.group.guidance).toContain('Avoid passing unquoted paths');
    expect(one.body.group.guidance.length).toBeGreaterThan(400);
    expect(one.body.occurrences).toHaveLength(20);
    expect(one.body.has_more).toBe(true);
    expect(one.body.occurrences[0]).not.toHaveProperty('parent_call_id');

    // Page older occurrences with before + limit.
    const cursor = one.body.occurrences.at(-1).cursor;
    const older = await callOmni('tool_failures', { group_id: groupId(0), before: cursor, limit: 20 });
    expect(older.body.occurrences).toHaveLength(15);
    expect(older.body).not.toHaveProperty('has_more');

    // End-to-end triage flow: inspect group -> triage_tool_failure -> re-read group.
    const targetId = groupId(100);
    const beforeTriage = await callOmni('tool_failures', { group_id: targetId });
    expect(beforeTriage.body.group.guidance).toBe('');
    await callOmni('triage_tool_failure', { group_id: targetId, status: 'avoid', guidance: 'Pass normalized arguments.' });
    const afterTriage = await callOmni('tool_failures', { group_id: targetId });
    expect(afterTriage.body.group).toMatchObject({ group_id: targetId, status: 'avoid', guidance: 'Pass normalized arguments.' });
    const avoidList = await callOmni('tool_failures', { status: 'avoid', limit: 200 });
    const triagedRow = avoidList.body.groups.find((g: any) => g.group_id === targetId);
    expect(triagedRow).toMatchObject({ group_id: targetId, status: 'avoid', has_guidance: true });
    expect(triagedRow).not.toHaveProperty('guidance');
  });
});
