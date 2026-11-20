// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Mark } from '@omni/shared/message-context-marks.ts';
import type { Artifact } from '../src/api.ts';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }), useFeed: () => {}, useCrewRoles: () => [] }));
// happy-dom has no 2D canvas: the marks are drawn and flattened in a real browser (the QA run); here the render is
// stood in for, and what it was asked to flatten is checked.
const rendered: { src: string; marks: Mark[]; width: number }[] = [];
vi.mock('../src/components/browser-marks-canvas.ts', () => ({
  drawMarks: () => {},
  renderMarked: async (src: string, marks: Mark[], width: number) => {
    rendered.push({ src, marks: [...marks], width });
    return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
  },
}));

import { ImageAnnotateLayer, type AnnotationSent } from '../src/components/ImageAnnotate.tsx';

// Annotate on an image in the Files panel: the marks drawn go out flattened as an attachment on a new message, with
// the notes in words, to the delegated thread that made the file, or to the panel's thread; a cold delegated thread
// says so and asks before it is woken.

const file = (thread_id: string): Artifact => ({ id: 7, thread_id, path: '/x/hero.png', name: 'hero.png', kind: 'image', size: 4, url: null, description: null, created_at: '2026-11-20T08:00:00Z', updated_at: '2026-11-20T08:00:00Z' });

let root: Root;
let host: HTMLDivElement;
let posts: { thread: string; payload: Record<string, unknown>; files: File[] }[];
let summaries: string[];
let warm: boolean;
let sent: AnnotationSent[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // The viewer is 640 by 400, and a 1280 by 800 image fits it at half size.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400, x: 0, y: 0, toJSON: () => ({}) });
  Element.prototype.setPointerCapture = vi.fn();
  rendered.length = 0;
  posts = [];
  summaries = [];
  warm = true;
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const m = /^\/api\/threads\/([^/]+)\/(messages|summary)$/.exec(url);
      if (m?.[2] === 'summary') {
        summaries.push(m[1]);
        return Response.json({ id: m[1], session: { warm, last_activity_at: null, idle_minutes: warm ? 3 : 140 } });
      }
      if (m?.[2] === 'messages' && init?.method === 'POST') {
        const fd = init.body as FormData;
        posts.push({ thread: m[1], payload: JSON.parse(fd.get('payload') as string), files: fd.getAll('files') as File[] });
        return Response.json({ id: m[1] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = async (a: Artifact, from?: { id: string; title: string }) => {
  await act(async () =>
    root.render(createElement(ImageAnnotateLayer, { a, threadId: 'parent', from, natural: { w: 1280, h: 800 }, onClose: () => {}, onSent: (s: AnnotationSent) => sent.push(s) })),
  );
};

const q = <T extends Element = HTMLElement>(sel: string) => {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`No ${sel}`);
  return el;
};
const byLabel = (label: string) => q<HTMLButtonElement>(`[aria-label="${label}"]`);
const button = (text: string) => {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`No button ${text}`);
  return b;
};
const click = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const pointer = (type: string, x: number, y: number) =>
  act(async () => void q('[role="img"]').dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' })));
const drag = async (x0: number, y0: number, x1: number, y1: number) => {
  await pointer('pointerdown', x0, y0);
  await pointer('pointermove', (x0 + x1) / 2, (y0 + y1) / 2);
  await pointer('pointermove', x1, y1);
  await pointer('pointerup', x1, y1);
};
const type = async (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe('ImageAnnotateLayer', () => {
  it('sends a box, an arrow and a text note on a delegated file to that thread, as an attachment and the note text', async () => {
    await mount(file('child'), { id: 'child', title: 'Build the hero' });
    await settle();
    expect(summaries).toEqual(['child']);
    // It starts on the rectangle.
    await drag(20, 20, 120, 80);
    await click(byLabel('Shapes, Rectangle on'));
    await click(byLabel('Arrow'));
    await drag(300, 300, 140, 60);
    await click(byLabel('Text'));
    await pointer('pointerdown', 200, 40);
    await type(q<HTMLInputElement>('[data-mark-text]'), 'Make this bigger');
    await act(async () => void q('[data-mark-text]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await type(q<HTMLTextAreaElement>('textarea'), 'Tighten the hero');
    await click(button('Send'));
    await settle();

    expect(rendered).toHaveLength(1);
    expect(rendered[0].marks.map((m) => m.type)).toEqual(['rect', 'arrow', 'text']);
    expect(rendered[0].width).toBe(1280);
    expect(posts).toHaveLength(1);
    const [p] = posts;
    expect(p.thread).toBe('child');
    expect(p.files.map((f) => [f.name, f.type])).toEqual([['hero-annotated.png', 'image/png']]);
    const prompt = p.payload.prompt as string;
    expect(prompt.startsWith('Tighten the hero\n\nThe attached image is hero.png, marked up.')).toBe(true);
    expect(prompt).toContain('Notes on the image:\n1. "Make this bigger" (red, at x 400, y 80)');
    expect(prompt).toContain('- red rectangle at x 40, y 40, 200×120');
    expect(prompt).toContain('- red arrow from x 600, y 600 to x 280, y 120');
    expect(sent).toEqual([{ thread: 'child', label: 'Build the hero' }]);
  });

  it('sends a file of the panel thread to it, without asking about warmth', async () => {
    await mount(file('parent'));
    await settle();
    expect(summaries).toEqual([]);
    expect(host.textContent).toContain('Sends to this thread');
    await drag(20, 20, 120, 80);
    await click(button('Send'));
    await settle();
    expect(posts.map((p) => p.thread)).toEqual(['parent']);
    expect(posts[0].files.map((f) => f.name)).toEqual(['hero-annotated.png']);
  });

  it('says a cold delegated thread will be woken, and sends to the panel thread instead when asked', async () => {
    warm = false;
    await mount(file('child'), { id: 'child', title: 'Build the hero' });
    await settle();
    expect(q('[data-cold]').textContent).toContain('Build the hero has been idle 140 minutes');
    expect(button('Wake and send')).toBeTruthy();
    await click(button('Send to this thread instead'));
    await settle();
    expect(host.querySelector('[data-cold]')).toBeNull();
    await type(q<HTMLTextAreaElement>('textarea'), 'Use the brand red');
    await click(button('Send'));
    await settle();
    expect(posts.map((p) => p.thread)).toEqual(['parent']);
    // Sent here, the message names the thread the file came from.
    expect(posts[0].payload.prompt).toContain('The attached image is hero.png from "Build the hero", marked up.');
  });

  it('sends nothing with no marks and no message', async () => {
    await mount(file('parent'));
    expect(button('Send').disabled).toBe(true);
    expect(posts).toEqual([]);
  });

  it('clears every mark at once', async () => {
    await mount(file('parent'));
    await drag(20, 20, 120, 80);
    await drag(200, 200, 300, 300);
    expect(byLabel('Clear all marks').disabled).toBe(false);
    await click(byLabel('Clear all marks'));
    expect(byLabel('Clear all marks').disabled).toBe(true);
    expect(button('Send').disabled).toBe(true);
  });
});
