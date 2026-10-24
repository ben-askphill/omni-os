import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotate, type PickedElement } from '@omni/shared/message-context-browser.ts';
import { startRunner } from './runner-boot.ts';

// The element pick against a real Chrome, over CDP: the page script on nested and scrolled elements, same-origin frames,
// a frame from another site, shadow DOM, fields, and a page that moves between the screenshot and the pick. Skipped where
// there is no Chrome. The channel browser is a throwaway: its own profile under the test's data dir, never Ben's.

process.env.SHELL = '/bin/sh';
const T = { timeout: 60_000 };
// Env is set by startRunner before any server module loads, so the browser module is imported after it.
const H = await startRunner();
const { chromeBinary, channelBrowser } = await import('../browser.ts');
const pick = await import('../browser-pick.ts');
const cap = await import('../browser-capture.ts');
const hasChrome = !!chromeBinary();

let server: Server;
let origin: string;
let other: string;
let chrome: Awaited<ReturnType<typeof boot>>;

const PAGES: Record<string, string> = {
  '/main': `<!doctype html><title>Fixture</title>
<style>body{margin:0;font:16px sans-serif}#spacer{height:1500px}.row{height:60px}</style>
<div id="top" style="height:120px">top</div>
<div id="spacer">spacer</div>
<main id="cart"><section class="summary"><ul><li>First</li><li class="line"><a href="/pay?token=SECRET#frag" class="pay link">Pay <b>now</b></a></li><li>Third</li></ul>
<input id="card" name="card" type="password" value="hunter2" placeholder="Card number" style="width:200px">
<textarea id="notes" style="width:200px;height:40px">private notes</textarea>
<script>window.secret = 'not in markup'</script><style>.x{color:red}</style></section></main>
<iframe id="inner" src="/frame" style="width:400px;height:200px;border:0"></iframe>
<iframe id="foreign" src="OTHER/frame" style="width:400px;height:100px;border:0"></iframe>
<div id="host"></div>
<script>
  const r = document.getElementById('host').attachShadow({ mode: 'open' });
  r.innerHTML = '<button class="shadowed" style="width:120px;height:30px">In shadow</button>';
</script>
<div id="wall">${Array.from({ length: 3000 }, (_, i) => `<p class="row">Row ${i} ${'lorem ipsum '.repeat(20)}</p>`).join('')}</div>`,
  '/frame': `<!doctype html><body style="margin:0"><div id="fbox" style="padding:10px"><button id="fbtn" style="width:150px;height:40px">Inside frame</button>
<iframe id="deeper" src="/deep" style="width:200px;height:60px;border:0"></iframe></div>`,
  '/deep': `<!doctype html><body style="margin:0"><a id="dlink" href="/x" style="display:block;width:100px;height:30px">Deep link</a>`,
};

async function boot() {
  const b = channelBrowser('pick-cdp', true);
  await b.start();
  await b.resize(1000, 700, 1);
  return b;
}

beforeAll(async () => {
  if (!hasChrome) return;
  const dir = mkdtempSync(join(tmpdir(), 'omni-pick-cdp-'));
  H.db.channels.create({ id: 'pick-cdp', name: 'Pick', kind: 'internal', use_worktree: 0, repo_path: dir, base_dir: dir });
  server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const html = PAGES[path]?.replace('OTHER', other);
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' }).end(html ?? 'no');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  // A different host is a different origin: its frame cannot be read from the page.
  other = `http://localhost:${port}`;
  chrome = await boot();
}, 90_000);

afterAll(async () => {
  chrome?.close();
  await new Promise((r) => (server ? server.close(r) : r(null)));
});

/** Runs an expression in the page, as the picker does. */
const inPage = async (expression: string) => (await (chrome as any).page('Runtime.evaluate', { expression, returnByValue: true })).result.value;
const load = async (path: string, scrollY = 0) => {
  await chrome.navigate(`${origin}${path}`);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if ((await inPage(`document.readyState === 'complete' && [...document.querySelectorAll('iframe')].every((f) => { try { return f.contentDocument ? f.contentDocument.readyState === 'complete' : true; } catch { return true; } })`)) === true) break;
  }
  await inPage(`scrollTo(0, ${scrollY})`);
  await new Promise((r) => setTimeout(r, 150));
};
/** A point in an element of the main page, `at` of the way across and down it, in viewport pixels. */
const centre = async (selector: string, at: [number, number] = [0.5, 0.5]) => {
  const r = await inPage(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width * ${at[0]}), y: Math.round(b.top + b.height * ${at[1]}) }; })()`);
  return r as { x: number; y: number };
};
/** The centre of an element inside the frames named by `path` (ids, outermost first), in viewport pixels. */
const centreIn = async (path: string[], inner: string) => {
  const r = await inPage(`(() => { let doc = document, x = 0, y = 0; for (const id of ${JSON.stringify(path)}) { const f = doc.getElementById(id); const b = f.getBoundingClientRect(); x += b.left; y += b.top; doc = f.contentDocument; } const b = doc.getElementById(${JSON.stringify(inner)}).getBoundingClientRect(); return { x: Math.round(x + b.left + b.width / 2), y: Math.round(y + b.top + b.height / 2) }; })()`);
  return r as { x: number; y: number };
};
const thread = async () => {
  const t = await H.runner.createThread({ channel: 'pick-cdp', prompt: 'CMD hi' });
  await H.untilResults(t.id, 1);
  return t;
};
/** A capture of the live page, remembered, and what the pick then answers at a point. */
async function pickAfterCapture(point: { x: number; y: number }, between?: () => Promise<void>) {
  const t = await thread();
  const r = await cap.captureAnnotation(chrome, t.id);
  if (!r.ok) throw new Error(r.error);
  pick.remember(t.id, r.capture.image.name, r.page);
  await between?.();
  return { capture: r.capture, answer: await pick.pickElement(chrome, t.id, r.capture.image.name, point) };
}
const element = (a: Awaited<ReturnType<typeof pickAfterCapture>>['answer']): PickedElement => {
  if (a === 'bad_point' || !('element' in a)) throw new Error(`no element: ${JSON.stringify(a)}`);
  return a.element;
};

describe.skipIf(!hasChrome)('picking an element in a real Chrome', () => {
  it('describes a nested, scrolled element: selector from the nearest id, text, bounds in the viewport', T, async () => {
    await load('/main', 1500);
    const p = await centre('a.pay', [0.1, 0.5]);
    const { capture, answer } = await pickAfterCapture(p);
    const e = element(answer);
    expect(capture.scroll.y).toBeGreaterThan(1000);
    expect(e.tag).toBe('a');
    expect(e.selector.startsWith('#cart > ')).toBe(true);
    expect(e.selector).toMatch(/li\.line:nth-of-type\(2\) > a\.pay\.link$/);
    expect(await inPage(`document.querySelectorAll(${JSON.stringify(e.selector)}).length`)).toBe(1);
    expect(e.text).toBe('Pay now');
    expect(e.html).toContain('<a class="pay link" href="/pay">Pay<b>');
    expect(e.ancestors[0]).toMatch(/^<li class="line">/);
    expect(e.bounds.y).toBeGreaterThan(0);
    expect(e.bounds.y).toBeLessThan(700);
    expect(e.point).toEqual(p);
    expect(e.frames).toEqual([]);
    expect(annotate(capture, { x: e.bounds.x, y: e.bounds.y, width: e.bounds.width, height: e.bounds.height }, e).ok).toBe(true);
  });

  it('leaves out a link\'s query and fragment, scripts and styles', T, async () => {
    await load('/main', 1500);
    const { answer } = await pickAfterCapture(await centre('main section', [0.9, 0.05]));
    const e = element(answer);
    expect(e.html).not.toContain('SECRET');
    expect(e.html).not.toContain('not in markup');
    expect(e.html).not.toContain('color:red');
    const link = element((await pickAfterCapture(await centre('a.pay', [0.1, 0.5]))).answer);
    expect(link.html + link.ancestors.join('')).not.toContain('SECRET');
    expect(link.html).toContain('href="/pay"');
  });

  it('never reads what was typed into a field', T, async () => {
    await load('/main', 1500);
    const field = element((await pickAfterCapture(await centre('#card'))).answer);
    expect(field).toMatchObject({ tag: 'input', selector: '#card', text: '' });
    expect(field.html).not.toContain('hunter2');
    expect(field.html).toContain('placeholder="Card number"');
    const area = element((await pickAfterCapture(await centre('#notes'))).answer);
    expect(area).toMatchObject({ tag: 'textarea', text: '' });
    expect(JSON.stringify(area)).not.toContain('private notes');
  });

  it('bounds a pick of a huge container: no whole-DOM dump', T, async () => {
    await load('/main', 1500);
    const wall = await inPage(`document.getElementById('wall').outerHTML.length`);
    expect(wall).toBeGreaterThan(500_000);
    await inPage(`scrollTo(0, document.getElementById('wall').offsetTop)`);
    await new Promise((r) => setTimeout(r, 150));
    const { answer } = await pickAfterCapture({ x: 5, y: 5 });
    const e = element(answer);
    expect(JSON.stringify(e).length).toBeLessThan(6_500);
    expect([...e.html].length).toBeLessThanOrEqual(2000);
    expect([...e.text].length).toBeLessThanOrEqual(600);
    const body = element((await pickAfterCapture({ x: 900, y: 1 })).answer);
    expect([...body.html].length).toBeLessThanOrEqual(2000);
  });

  it('describes an element inside a same-origin frame, with the frame\'s address and the page\'s coordinates', T, async () => {
    await load('/main', 0);
    await inPage(`document.getElementById('inner').scrollIntoView()`);
    await new Promise((r) => setTimeout(r, 150));
    const box = await inPage(`(() => { const b = document.getElementById('inner').getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
    const { answer } = await pickAfterCapture(await centreIn(['inner'], 'fbtn'));
    const e = element(answer);
    expect(e).toMatchObject({ tag: 'button', selector: '#fbtn', text: 'Inside frame', opaque_frame: false });
    expect(e.frames).toEqual([`${origin}/frame`]);
    // The button sits 10px into the frame: its box is in the page's viewport, not the frame's.
    expect(e.bounds).toMatchObject({ x: Math.floor(box.x) + 10, width: 150 });
    // Outward to whole pixels, so a box at a half pixel is a pixel taller.
    expect(e.bounds.height).toBeGreaterThanOrEqual(40);
    expect(e.bounds.height).toBeLessThanOrEqual(41);
    expect(e.bounds.y).toBeGreaterThan(Math.floor(box.y) + 9);
  });

  it('goes through frames inside frames, and says each', T, async () => {
    await load('/main', 0);
    await inPage(`document.getElementById('inner').scrollIntoView()`);
    await new Promise((r) => setTimeout(r, 150));
    const { answer } = await pickAfterCapture(await centreIn(['inner', 'deeper'], 'dlink'));
    const e = element(answer);
    expect(e).toMatchObject({ tag: 'a', selector: '#dlink', text: 'Deep link' });
    expect(e.frames).toEqual([`${origin}/frame`, `${origin}/deep`]);
  });

  it('gives the frame element itself for a frame from another site, and reads nothing inside it', T, async () => {
    await load('/main', 0);
    await inPage(`document.getElementById('foreign').scrollIntoView()`);
    await new Promise((r) => setTimeout(r, 150));
    const p = await centre('#foreign');
    const { capture, answer } = await pickAfterCapture(p);
    const e = element(answer);
    expect(e).toMatchObject({ tag: 'iframe', selector: '#foreign', opaque_frame: true, text: '', frames: [] });
    expect(e.html).toContain('<iframe');
    expect(JSON.stringify(e)).not.toContain('Inside frame');
    // The screenshot path is untouched by it.
    expect(capture.image.bytes).toBeGreaterThan(0);
  });

  it('goes into an open shadow root', T, async () => {
    await load('/main', 0);
    await inPage(`document.getElementById('host').scrollIntoView()`);
    await new Promise((r) => setTimeout(r, 150));
    const p = await inPage(`(() => { const b = document.getElementById('host').shadowRoot.querySelector('button').getBoundingClientRect(); return { x: Math.round(b.left + 10), y: Math.round(b.top + 10) }; })()`);
    const e = element((await pickAfterCapture(p)).answer);
    expect(e).toMatchObject({ tag: 'button', text: 'In shadow' });
    expect(e.selector).toBe('#host >>> button.shadowed');
  });

  it('is unavailable when the page navigates between the screenshot and the pick, and when it scrolls', T, async () => {
    await load('/main', 1500);
    const p = await centre('a.pay');
    const navigated = await pickAfterCapture(p, async () => {
      await load('/frame', 0);
    });
    expect(navigated.answer).toMatchObject({ unavailable: { reason: 'stale', message: expect.stringMatching(/navigated/) } });
    await load('/main', 1500);
    const scrolled = await pickAfterCapture(await centre('a.pay'), async () => {
      await inPage('scrollBy(0, 300)');
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(scrolled.answer).toMatchObject({ unavailable: { reason: 'stale', message: expect.stringMatching(/scrolled/) } });
  });

  it('is unavailable after a switch to another tab, and never reads that tab', T, async () => {
    await load('/main', 1500);
    const p = await centre('a.pay');
    const switched = await pickAfterCapture(p, async () => {
      await chrome.newTab(`${origin}/frame`);
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(switched.answer).toMatchObject({ unavailable: { reason: 'stale', message: expect.stringMatching(/switched tabs/) } });
    expect(JSON.stringify(switched.answer)).not.toContain('Inside frame');
    const tabs = chrome.state().tabs;
    const first = tabs.find((t) => t.url.endsWith('/main'));
    if (first) await chrome.attach(first.id);
  });

  it('still takes the screenshot of a page the pick cannot read', T, async () => {
    await load('/main', 0);
    const t = await thread();
    const r = await cap.captureAnnotation(chrome, t.id);
    expect(r.ok).toBe(true);
    const nothing = await pick.pickElement(chrome, t.id, r.ok ? r.capture.image.name : '', { x: 1, y: 1 });
    // Never remembered by the capture route's hook here: the screenshot alone is a usable record.
    expect(nothing).toMatchObject({ unavailable: { reason: 'unknown_capture' } });
    if (r.ok) expect(annotate(r.capture, { x: 0, y: 0, width: 100, height: 100 }).ok).toBe(true);
  });
});
