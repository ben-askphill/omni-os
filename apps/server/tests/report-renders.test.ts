import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReportRender } from '@omni/shared/report-pages.ts';
import { startRunner } from './runner-boot.ts';
import { hasMcpBuild } from './support.ts';

// A page a delegated thread showed with html_render (crates/omni-mcp) rides up on its crew report, so the thread it
// reports to shows it with the report, the Conductor's delegation card included (apps/server/report-renders.ts). A
// thread further down hands its pages up through each report, once: a later report of the same thread carries only
// what it showed since.

let H: Awaited<ReturnType<typeof startRunner>>;
let server: Server | undefined;
const T = { timeout: 40_000 };

beforeAll(async () => {
  H = await startRunner();
  // A thread's MCP servers call Omni over HTTP, as on a real install.
  const { app } = await import('../app.ts');
  const { serve } = await import('@hono/node-server');
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(server, 'listening');
  const { about } = await import('../about.ts');
  about.port = (server.address() as AddressInfo).port;
}, 60_000);

afterAll(() => {
  server?.close();
  server?.closeAllConnections();
});

const reportsFrom = (parentId: string, childId: string) => H.byKind(parentId, 'crew_report').filter((e) => e.p.thread_id === childId);
const rendersOf = (p: { renders?: ReportRender[] }) => (p.renders ?? []).map((r) => `${r.title} (${r.thread_id.slice(0, 8)})`);
const detail = async (id: string) => {
  const { threadRoutesApi } = await import('../thread-routes-api.ts');
  return (await (await threadRoutesApi.request(`/${id}`)).json()) as { report_renders?: { thread_id: string; name: string; path: string }[] };
};

describe.skipIf(!hasMcpBuild)('pages a delegated thread showed', () => {
  it('ride on its report to the thread that delegated it, and its detail lists their files', T, async () => {
    const parent = await H.start('THINK:1 hand it off');
    await H.untilResults(parent.id, 1);
    const child = await H.start('RENDER:Commits-by-package SAY:Counted the commits by package.', { parent_id: parent.id, role: 'builder' });
    await H.untilResults(child.id, 1, 30_000);
    await H.untilResults(parent.id, 2);

    const [report] = reportsFrom(parent.id, child.id);
    expect(report.p.renders).toEqual([{ thread_id: child.id, name: expect.stringMatching(/^commits-by-package-[0-9a-f]{6}\.html$/), title: 'Commits by package' }]);
    // The parent's agent knows the user sees the page, so it does not describe it again.
    expect(H.claudeTexts(parent.id).at(-1)).toContain('"Commits by package"');
    // The parent's detail has the page's file, so its transcript can draw it whatever its crew list holds.
    const rows = (await detail(parent.id)).report_renders ?? [];
    expect(rows.map((a) => [a.thread_id, a.name])).toEqual([[child.id, report.p.renders[0].name]]);
  });

  it('shows on the Conductor delegation card it reports to in place', T, async () => {
    const conductor = await H.start('THINK:1', { role: 'conductor' });
    await H.untilResults(conductor.id, 1);
    const child = await H.start('RENDER:Review-apps-compared SAY:Judge.me wins.', { parent_id: conductor.id, role: 'researcher' });
    await H.untilResults(child.id, 1, 30_000);
    await H.until('a shown report', () => reportsFrom(conductor.id, child.id)[0]);
    const [report] = reportsFrom(conductor.id, child.id);
    expect(report.p).toMatchObject({ shown: true });
    expect(rendersOf(report.p)).toEqual([`Review apps compared (${child.id.slice(0, 8)})`]);
  });

  it('hands a grandchild page up once, through the report of the thread between', T, async () => {
    const top = await H.start('THINK:1 lead');
    await H.untilResults(top.id, 1);
    const mid = await H.start('SAY:Asked a researcher.', { parent_id: top.id, role: 'builder' });
    await H.untilResults(mid.id, 1);
    await H.untilResults(top.id, 2);
    expect(reportsFrom(top.id, mid.id)[0].p.renders ?? []).toEqual([]);

    const leaf = await H.start('RENDER:Review-apps-compared SAY:Judge.me wins.', { parent_id: mid.id, role: 'researcher' });
    await H.untilResults(leaf.id, 1, 30_000);
    // The leaf's report wakes the thread between, whose turn then reports to the top with the leaf's page.
    await H.untilResults(mid.id, 2);
    await H.untilResults(top.id, 3);
    const want = [`Review apps compared (${leaf.id.slice(0, 8)})`];
    expect(rendersOf(reportsFrom(mid.id, leaf.id)[0].p)).toEqual(want);
    expect(rendersOf(reportsFrom(top.id, mid.id)[1].p)).toEqual(want);

    // Its next report carries only what it showed since: the page went up already.
    H.db.events.add(mid.id, 'user', { text: 'one more thing' });
    H.db.events.add(mid.id, 'assistant_text', { text: 'Done that too.' });
    H.runner.reportToParent(mid.id, 'done', 'Done that too.');
    await H.untilResults(top.id, 4);
    expect(reportsFrom(top.id, mid.id)).toHaveLength(3);
    expect(reportsFrom(top.id, mid.id)[2].p.renders ?? []).toEqual([]);
    // The top's detail has the leaf's file, though the leaf never reported to it.
    expect(((await detail(top.id)).report_renders ?? []).map((a) => a.thread_id)).toEqual([leaf.id]);
  });
});
