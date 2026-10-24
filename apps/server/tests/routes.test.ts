import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Every router mounts on the one /api tree, so a path two of them claim answers from whichever app.ts mounts first and
// the other never runs. #221's text transcript once took GET /threads/:id/history from #223's history pages this way.
await startRunner({});
const { app } = await import('../app.ts');

describe('the API routes', () => {
  it('give each method and path one endpoint', () => {
    // A middleware (bodyLimit and the like) takes next; an endpoint takes only the context.
    const endpoints = app.routes.filter((r) => r.method !== 'ALL' && r.handler.length < 2).map((r) => `${r.method} ${r.path}`);
    expect(endpoints.length).toBeGreaterThan(100);
    expect(endpoints.filter((k, i) => endpoints.indexOf(k) !== i)).toEqual([]);
  });
});
