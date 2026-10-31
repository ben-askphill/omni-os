import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The artifact reads by page and by thread (#391) run on artifacts_url and artifacts_thread, never a table scan.

const r = await startRunner();
const { ARTIFACT_SQL } = await import('../db/repos/artifacts.ts');

describe('artifact query plans', () => {
  it('reads by page and by thread through an index', () => {
    const want: Record<keyof typeof ARTIFACT_SQL, RegExp> = {
      published: /artifacts_url/,
      byUrl: /SEARCH artifacts USING INDEX artifacts_url \(url=\?\)/,
      byThread: /SEARCH artifacts USING INDEX artifacts_thread \(thread_id=\?\)/,
    };
    for (const [name, sql] of Object.entries(ARTIFACT_SQL) as [keyof typeof ARTIFACT_SQL, string][]) {
      const params = Array(sql.split('?').length - 1).fill(1);
      const plan = (r.db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((p) => p.detail);
      expect(plan.filter((d) => /^SCAN (artifacts|a|b)\b/.test(d)), `${name}: ${plan.join('; ')}`).toEqual([]);
      expect(plan.join('; '), name).toMatch(want[name]);
    }
  });

  it('still returns the newest file per page', () => {
    r.db.threads.create({
      id: 'plan-t', channel_id: 'scratch', title: 'Plans', status: 'done', role: null, model: null, session_id: 'plan-t', cwd: r.tmp,
      branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });
    const a = r.db.artifacts.upsert({ thread_id: 'plan-t', path: `${r.tmp}/a.html`, name: 'a.html', kind: 'html', size: 1 });
    const b = r.db.artifacts.upsert({ thread_id: 'plan-t', path: `${r.tmp}/b.html`, name: 'b.html', kind: 'html', size: 1 });
    r.db.artifacts.setPublished(a.id, 'https://claude.ai/x', null);
    r.db.artifacts.setPublished(b.id, 'https://claude.ai/x', null);
    expect(r.db.artifacts.published().map((x) => x.id)).toEqual([b.id]);
    expect(r.db.artifacts.byUrl('https://claude.ai/x')?.id).toBe(b.id);
    expect(r.db.artifacts.byThread('plan-t').map((x) => x.id)).toEqual([a.id, b.id]);
  });
});
