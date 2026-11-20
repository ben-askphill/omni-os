import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotatedName, annotationPrompt } from '@omni/shared/image-annotation.ts';
import { startRunner } from './runner-boot.ts';

// An image annotated in a parent thread's Files panel (apps/web/src/components/ImageAnnotate.tsx) goes to the delegated
// thread that made the file as Ben's new message: the flattened PNG saved as that thread's attachment, the notes in
// its text, and nothing posted to the parent. The client sends it through the same multipart route as the reply box.

let h: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
const T = { timeout: 30_000 };
// A 1×1 PNG: the bytes the canvas flattens to, for the round trip.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  h = await startRunner();
  ({ app } = await import('../app.ts'));
  const dir = mkdtempSync(join(tmpdir(), 'omni-annotate-'));
  h.db.channels.create({ id: 'ann', name: 'Annotate', kind: 'internal', use_worktree: 0, repo_path: null, base_dir: dir });
});

const users = (id: string) => h.byKind(id, 'user').map((e) => e.p);

describe('sending an annotated image', () => {
  it('saves the PNG as an attachment on the delegated thread and posts the notes there', T, async () => {
    const parent = await h.runner.createThread({ channel: 'ann', prompt: 'hello' });
    await h.untilResults(parent.id, 1);
    const child = await h.runner.createThread({ channel: 'ann', prompt: 'hello', parent_id: parent.id });
    await h.untilResults(child.id, 1);
    const before = users(parent.id).length;

    const name = annotatedName('hero.png', 'image/png');
    const prompt = annotationPrompt({
      message: 'Tighten the hero',
      source: 'hero.png',
      marks: [
        { type: 'rect', color: '#ff4420', stroke: 4, x: 10, y: 10, width: 40, height: 30 },
        { type: 'text', color: '#ff4420', stroke: 4, x: 60, y: 12, text: 'Make this bigger' },
      ],
      k: 1,
    });
    const fd = new FormData();
    fd.append('payload', JSON.stringify({ prompt, request_id: 'annotate-1' }));
    fd.append('files', new File([PNG], name, { type: 'image/png' }), name);
    const res = await app.request(`/api/threads/${child.id}/messages`, { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    await h.untilResults(child.id, 2);

    const sent = users(child.id).at(-1);
    expect(sent.text).toBe(prompt);
    expect(sent.attachments.map((a: { name: string }) => a.name)).toEqual([name]);
    const upload = await app.request(`/api/threads/${child.id}/uploads/${encodeURIComponent(name)}`);
    expect(upload.status).toBe(200);
    expect(Buffer.from(await upload.arrayBuffer()).equals(PNG)).toBe(true);
    // The agent is told about the file and reads the notes.
    const harness = h.claudeTexts(child.id).at(-1)!;
    expect(harness).toContain('1. "Make this bigger"');
    expect(harness).toContain(name);
    expect(users(parent.id)).toHaveLength(before);
  });
});
