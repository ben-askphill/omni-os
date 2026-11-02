import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// A stream opened with a device session must end with the session (apps/server/sse.ts). A route that calls Hono's
// streamSSE directly keeps streaming after a revoke, so none may.
it('opens every SSE stream through sessionSSE', () => {
  const root = join(import.meta.dirname, '..');
  const offenders = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.parentPath.includes('node_modules') && !e.parentPath.includes(`${root}/tests`))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !f.endsWith('/sse.ts') && /\bstreamSSE\b/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
