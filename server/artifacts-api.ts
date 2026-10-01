// /api/artifacts: recent artifacts, and the raw file for one of them.
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { mimeFor } from './artifacts.ts';
import { paths } from './config.ts';
import { artifacts } from './db.ts';
import { threadFilesReady } from './sync/files.ts';

export const artifactsApi = new Hono();

artifactsApi.get('/', (c) => c.json(artifacts.recent()));

artifactsApi.get('/:id/raw', async (c) => {
  const a = artifacts.get(Number(c.req.param('id')));
  if (a && !existsSync(a.path)) await threadFilesReady(a.thread_id);
  // A path that escapes the threads dir is the same as missing. Do not serve it.
  if (!a || !existsSync(a.path) || relative(paths.threads, a.path).startsWith('..')) return c.text('not found', 404);
  c.header('Content-Type', mimeFor(a.path, a.kind));
  c.header('Cache-Control', 'no-store');
  if (c.req.query('download')) c.header('Content-Disposition', `attachment; filename="${a.name}"`);
  return c.body(readFileSync(a.path));
});
