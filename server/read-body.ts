import type { Context } from 'hono';

/**
 * Message bodies arrive as JSON, or as multipart when the composer has attachments:
 * a `payload` field with the same JSON plus one `files` entry per attachment.
 */
export async function readBody(c: Context): Promise<{ data: unknown; files: File[] }> {
  if (!(c.req.header('content-type') ?? '').includes('multipart/form-data')) return { data: await c.req.json(), files: [] };
  const form = await c.req.parseBody({ all: true });
  const raw = form.payload;
  const entry = form.files;
  return {
    data: typeof raw === 'string' ? JSON.parse(raw) : {},
    files: (Array.isArray(entry) ? entry : entry ? [entry] : []).filter((f): f is File => f instanceof File),
  };
}
