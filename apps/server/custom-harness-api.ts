// /harnesses/custom: list, add, change, test and remove custom harnesses (harness/custom.ts), and /harnesses/connect,
// Connect an agent's steps (agent-connect.ts). Reads are open to every client.
// A write decides where briefs go and which secret travels to which server, so it is Ben's only (decision F9 of
// docs/plans/2026-11-18-connect-an-agent.md):
// - an agent thread, known by its own token (automation-guard.ts callerOf), never writes one;
// - and only the install's token or a session paired with it may (request-guard.ts shellAllowed), as for a shell: a
//   stolen Google or Connect session could otherwise point a harness at its own server and name any secret as its key.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { pairHelperCommand } from '@omni/shared/connect-agent.ts';
import { about } from './about.ts';
import { connectAgent, findAgent, pairAgent, removeAgent, removeAgentServer, testAgentServer, testConnection, testSaved } from './agent-connect.ts';
import { callerOf } from './automation-guard.ts';
import { channels } from './db.ts';
import { checkCustomHarness, getCatalog } from './harness/catalog-service.ts';
import { customHarnesses } from './harness/custom.ts';
import { customHarnessSave, saveCustomHarness } from './harness/custom-store.ts';
import { userName } from './profile.ts';
import { omniRepo } from './user-config.ts';
import { shellAllowed } from './request-guard.ts';

export const customHarnessApi = new Hono();

/** Every custom harness here, as its file says, with what the catalog last found. Never a key. */
customHarnessApi.get('/harnesses/custom', (c) => {
  const cat = getCatalog();
  return c.json(customHarnesses().map((h) => ({ ...h, catalog: cat.harnesses.find((x) => x.id === h.id) ?? null })));
});

customHarnessApi.post('/harnesses/custom/:slug', (c) => write(c, true));
customHarnessApi.put('/harnesses/custom/:slug', (c) => write(c, false));

/** Remove: revoke the key at the agent when it can, delete the secret Connect made, then the file. */
customHarnessApi.delete('/harnesses/custom/:slug', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  try {
    return c.json(await removeAgent(c.req.param('slug')));
  } catch (err) {
    return failed(c, err);
  }
});

/** The harness row's Test connection: a signed-in probe and one test turn with the key on this machine. */
customHarnessApi.post('/harnesses/custom/:slug/test', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  try {
    return c.json(await testSaved(c.req.param('slug')));
  } catch (err) {
    return failed(c, err);
  }
});

// ---------- a remote agent's Server card (ADR 0020): Test connection and Remove, for Hermes and connected servers ----------

customHarnessApi.post('/crew/:id/server/test', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  try {
    return c.json(await testAgentServer(c.req.param('id')));
  } catch (err) {
    return failed(c, err);
  }
});

customHarnessApi.delete('/crew/:id/server', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  try {
    return c.json(await removeAgentServer(c.req.param('id'), () => ({ catalog: getCatalog(), channelExists: (id) => !!channels.get(id) })));
  } catch (err) {
    return failed(c, err);
  }
});

// ---------- Connect an agent (agent-connect.ts): find, sign in, test, then connect ----------

/**
 * The Hermes pairing helper's command from this Omni's own GitHub repo (its checkout's origin), pinned to this build:
 * its commit in a checkout, its release tag in the app. No command when there is no GitHub origin to fetch it from.
 */
customHarnessApi.get('/harnesses/connect/helper', (c) => {
  const repo = omniRepo();
  const ref = about.gitHead ?? `v${about.version}`;
  return c.json({ command: repo ? pairHelperCommand(repo, ref) : null, repo, ref });
});

const text = (max: number) => z.string().trim().max(max).optional();

customHarnessApi.post('/harnesses/connect/find', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  const body = z.object({ url: text(500), pair: text(500), code: text(100), name: text(200) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send { url, pair?, code?, name? }.' }, 400);
  return c.json(await findAgent(body.data));
});

customHarnessApi.post('/harnesses/connect/pair', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  const body = z.object({ url: text(500), pair: text(500), code: z.string().trim().min(1).max(100), name: text(200), kind: z.enum(['runs-api', 'eve']).optional() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send { url?, pair?, code }.' }, 400);
  try {
    return c.json(await pairAgent(body.data));
  } catch (err) {
    return failed(c, err);
  }
});

customHarnessApi.post('/harnesses/connect/test', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  const body = z.object({ draft: text(100), url: text(500), secret: text(64), kind: z.enum(['runs-api', 'eve']).optional() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send { draft } or { url, secret }.' }, 400);
  try {
    return c.json(await testConnection(body.data));
  } catch (err) {
    return failed(c, err);
  }
});

customHarnessApi.post('/harnesses/connect', async (c) => {
  const refusal = guard(c);
  if (refusal) return refusal;
  const body = z
    .object({ slug: z.string().trim().min(1).max(48), name: z.string().trim().min(1).max(80), draft: text(100), url: text(500), secret: text(64), kind: z.enum(['runs-api', 'eve']).optional(), bills: text(160), description: text(300), role: z.boolean().default(true) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Send { slug, name, draft or url and secret, role }.' }, 400);
  try {
    const done = await connectAgent(body.data, () => ({ catalog: getCatalog(), channelExists: (id) => !!channels.get(id) }));
    return c.json({ ...done, harness: { ...done.harness, catalog: getCatalog().harnesses.find((h) => h.id === done.harness.id) ?? null } }, 201);
  } catch (err) {
    return failed(c, err);
  }
});

/** A 403 for a write that is not Ben's own. */
function guard(c: Context) {
  if (callerOf(c)) return c.json({ error: `Only ${userName()} adds, changes or removes remote agents.` }, 403);
  if (!shellAllowed(c))
    return c.json({ error: "A custom harness sends a secret from this machine to its server, so changing one needs the install's token or a browser paired with it." }, 403);
  return null;
}

/** Save, then probe the harness at once, so the answer says whether it is ready. */
async function write(c: Context, create: boolean) {
  const refusal = guard(c);
  if (refusal) return refusal;
  const parsed = customHarnessSave.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid custom harness' }, 400);
  try {
    const harness = saveCustomHarness(c.req.param('slug') ?? '', parsed.data, { create });
    return c.json({ ...harness, catalog: await checkCustomHarness(harness.id) }, create ? 201 : 200);
  } catch (err) {
    return failed(c, err);
  }
}

function failed(c: Context, err: unknown) {
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 404 || status === 409 || status === 502) return c.json({ error: (err as Error).message }, status);
  throw err;
}
