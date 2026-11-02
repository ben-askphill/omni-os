// /api/threads/:id/renders: what html_render (apps/mcp/render.ts) calls. The page is saved under the thread's
// artifacts/renders/ and recorded at once, so the artifact row reaches the clients before the call's result does.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { RENDER_MAX_BYTES, RENDER_MAX_TITLE } from '@omni/shared/html-render.ts';
import { register } from './artifacts.ts';
import { artifactsDir, paths } from './config.ts';
import { threads } from './db.ts';

export const rendersApi = new Hono();

/** A file name from the title: lowercase words, then a random suffix, so two pages with one title never collide. */
const fileName = (title: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'}-${randomBytes(3).toString('hex')}.html`;

/** `{ title, html }` in, `{ artifact }` out. A 400 says what to fix, and the agent reads it. */
rendersApi.post('/:id/renders', async (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'No such thread.' }, 404);
  const body = (await c.req.json().catch(() => null)) as { title?: unknown; html?: unknown } | null;
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, RENDER_MAX_TITLE) : '';
  const html = typeof body?.html === 'string' ? body.html : '';
  if (!title) return c.json({ error: 'Give the page a title.' }, 400);
  if (!html.trim()) return c.json({ error: 'The html is empty. Pass a complete, self-contained HTML document.' }, 400);
  if (Buffer.byteLength(html) > RENDER_MAX_BYTES) return c.json({ error: `The page is larger than ${RENDER_MAX_BYTES} bytes. Inline less data.` }, 400);
  const dir = join(artifactsDir(id), 'renders');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, fileName(title));
  writeFileSync(file, html);
  const artifact = register(relative(paths.threads, file));
  if (!artifact) return c.json({ error: 'Omni could not record the page.' }, 500);
  return c.json({ artifact });
});
