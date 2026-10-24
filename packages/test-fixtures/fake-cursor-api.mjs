#!/usr/bin/env node
// A fake Cursor Cloud Agents API (v1) for tests and the QA stack. It listens on 127.0.0.1 only and never calls out.
// Any bearer key works except "bad-key", which gets a 401. It never logs or stores the Authorization header's value.
//
// A run moves one step each time it is read: CREATING, RUNNING, then FINISHED with a reply, a branch and a PR. The
// prompt steers it like fake-claude's directives:
//   CLOUD:ERROR   the run ends in ERROR
//   CLOUD:EXPIRE  the run ends in EXPIRED
//   CLOUD:HOLD    the run stays RUNNING until it is cancelled
//   CLOUD:SLOW    four more reads of RUNNING before it finishes
//   CLOUD:NOREPO  the create answers 403 repository_access
//
//   node fake-cursor-api.mjs [port]   serve until killed, printing the URL
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const fail = (res, status, code, message) => json(res, status, { error: { code, message } });
const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'task';

/** Start the fake. `calls` records each request without its key: `auth` is "bearer", "basic" or null. */
export async function startFakeCursorApi({ port = 0 } = {}) {
  const agents = new Map();
  const runs = new Map();
  const calls = [];
  let prs = 100;

  const newRun = (agent, text) => {
    const run = {
      id: `run-${randomUUID()}`,
      agentId: agent.id,
      status: 'CREATING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prompt: text,
      reads: 0,
      started: Date.now(),
    };
    runs.set(run.id, run);
    agent.latestRunId = run.id;
    return run;
  };

  const view = (run) => {
    const agent = agents.get(run.agentId);
    const out = { id: run.id, agentId: run.agentId, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt };
    if (['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'].includes(run.status)) out.durationMs = run.durationMs;
    if (run.result) out.result = run.result;
    if (agent.branch) out.git = { branches: [{ repoUrl: `github.com/${agent.repo}`, branch: agent.branch, ...(agent.prUrl && { prUrl: agent.prUrl }) }] };
    return out;
  };

  /** One read moves the run one step. */
  const step = (run) => {
    const agent = agents.get(run.agentId);
    run.reads++;
    if (run.status === 'CREATING') run.status = 'RUNNING';
    else if (run.status === 'RUNNING') {
      if (run.prompt.includes('CLOUD:HOLD')) return;
      if (run.prompt.includes('CLOUD:SLOW') && run.reads < 6) return;
      agent.branch ??= `cursor/${slug(agent.name)}-${agent.id.slice(3, 7)}`;
      if (run.reads < 3) return; // pushed the branch, still working
      const end = run.prompt.includes('CLOUD:ERROR') ? 'ERROR' : run.prompt.includes('CLOUD:EXPIRE') ? 'EXPIRED' : 'FINISHED';
      run.status = end;
      run.durationMs = Date.now() - run.started;
      if (end === 'FINISHED') {
        agent.prUrl ??= `https://github.com/${agent.repo}/pull/${++prs}`;
        run.result = `Done: ${run.prompt.split('\n').pop().slice(0, 80)}`;
      }
    }
    run.updatedAt = new Date().toISOString();
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const header = req.headers.authorization ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7) : header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString().replace(/:$/, '') : '';
    const body = req.method === 'POST' ? await readBody(req) : null;
    calls.push({ method: req.method, path: url.pathname, body, auth: header.startsWith('Bearer ') ? 'bearer' : header.startsWith('Basic ') ? 'basic' : null });
    if (!key || key === 'bad-key') return json(res, 401, { code: 'error', message: 'Invalid User API Key' });

    const p = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return json(res, 200, { items: [{ id: 'composer-2', displayName: 'Composer 2' }, { id: 'claude-4.5-sonnet', displayName: 'Sonnet 4.5' }] });
    }
    if (req.method === 'POST' && url.pathname === '/v1/agents') {
      const text = body?.prompt?.text;
      if (!text) return fail(res, 400, 'validation_error', 'prompt.text is required');
      const repoUrl = body?.repos?.[0]?.url ?? '';
      if (!repoUrl) return fail(res, 400, 'repository_required', 'A repository is required');
      if (text.includes('CLOUD:NOREPO')) return fail(res, 403, 'repository_access', 'Cursor has no access to this repository');
      const id = body.agentId ?? `bc-${randomUUID()}`;
      if (agents.has(id)) return fail(res, 409, 'agent_id_conflict', 'An agent with this id exists');
      const repo = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      const agent = { id, name: body.name ?? 'Cloud agent', status: 'ACTIVE', url: `https://cursor.com/agents/${id}`, repo, startingRef: body.repos[0].startingRef ?? 'main', createdAt: new Date().toISOString() };
      agents.set(id, agent);
      const run = newRun(agent, text);
      return json(res, 201, { agent: agentView(agent), run: view(run) });
    }
    if (p[0] === 'v1' && p[1] === 'agents' && p[2]) {
      const agent = agents.get(p[2]);
      if (!agent) return fail(res, 404, 'agent_not_found', 'Agent not found');
      if (req.method === 'GET' && p.length === 3) return json(res, 200, agentView(agent));
      if (req.method === 'POST' && p[3] === 'runs' && p.length === 4) {
        const active = agent.latestRunId && runs.get(agent.latestRunId);
        if (active && (active.status === 'CREATING' || active.status === 'RUNNING')) return fail(res, 409, 'agent_busy', 'The agent already has an active run');
        if (!body?.prompt?.text) return fail(res, 400, 'validation_error', 'prompt.text is required');
        return json(res, 201, { run: view(newRun(agent, body.prompt.text)) });
      }
      const run = p[3] === 'runs' && p[4] ? runs.get(p[4]) : undefined;
      if (p[3] === 'runs' && p[4] && (!run || run.agentId !== agent.id)) return fail(res, 404, 'run_not_found', 'Run not found');
      if (req.method === 'GET' && run && p.length === 5) {
        step(run);
        return json(res, 200, view(run));
      }
      if (req.method === 'POST' && run && p[5] === 'cancel') {
        if (run.status !== 'CREATING' && run.status !== 'RUNNING') return fail(res, 409, 'run_not_cancellable', 'The run is not active');
        run.status = 'CANCELLED';
        run.durationMs = Date.now() - run.started;
        return json(res, 200, { id: run.id });
      }
    }
    return fail(res, 404, 'not_found', `No route for ${req.method} ${url.pathname}`);
  });

  const agentView = (a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    env: { type: 'cloud' },
    url: a.url,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
    latestRunId: a.latestRunId,
    repos: [{ url: `https://github.com/${a.repo}`, startingRef: a.startingRef }],
    autoCreatePR: true,
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    calls,
    agents,
    runs,
    reset() {
      calls.length = 0;
      agents.clear();
      runs.clear();
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fake = await startFakeCursorApi({ port: Number(process.argv[2] ?? 0) });
  console.log(fake.url);
}
