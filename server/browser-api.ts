// /api/channels/:id/browser: the channel's live browser, its stream, and input.
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { channelBrowser, existingBrowser, normalizeUrl, type BrowserEvent, type BrowserInput } from './browser.ts';
import { config } from './config.ts';
import { channels } from './db.ts';

export const browserApi = new Hono();

/** The channel's live browser, starting it on the way. 404 for an unknown channel, 409 with the browser off. */
function browserFor(c: Context) {
  const ch = channels.get(c.req.param('id')!);
  if (!ch) throw Object.assign(new Error('not found'), { status: 404 });
  if (!config.browser || !config.browserLive) throw Object.assign(new Error('The live browser is off (OMNI_BROWSER or OMNI_BROWSER_LIVE is 0)'), { status: 409 });
  return channelBrowser(ch.id, !!ch.browser_headless);
}

browserApi.get('/:id/browser', (c) => {
  const b = existingBrowser(c.req.param('id'));
  return c.json(b?.state() ?? { running: false, url: '', title: '', loading: false, canBack: false, canForward: false, tabs: [], active: null, viewport: { width: 1280, height: 713 } });
});

/** Live view: `state` messages, and `frame` messages with a JPEG. A slow client skips frames rather than queueing them. */
browserApi.get('/:id/browser/stream', (c) => {
  const b = browserFor(c);
  return streamSSE(c, async (stream) => {
    const states: BrowserEvent[] = [];
    let frame: BrowserEvent | null = null;
    let wake: (() => void) | null = null;
    let stop = () => {};
    stream.onAbort(() => {
      stop();
      wake?.();
    });
    await stream.writeSSE({ event: 'ping', data: '' });
    try {
      await b.start();
    } catch (err) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: (err as Error).message }) });
      return;
    }
    stop = b.watch((e) => {
      if (e.type === 'frame') frame = e;
      else states.push(e);
      wake?.();
    });
    while (!stream.aborted) {
      if (!states.length && !frame) {
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(20_000)]);
        wake = null;
        if (!states.length && !frame) await stream.writeSSE({ event: 'ping', data: '' });
        continue;
      }
      const next: BrowserEvent = states.shift() ?? frame!;
      if (next === frame) frame = null;
      await stream.writeSSE({ data: JSON.stringify(next) });
    }
    stop();
  });
});

const mods = z.number().int().min(0).max(15).optional();
const browserInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mouse'), event: z.enum(['mousePressed', 'mouseReleased', 'mouseMoved']), x: z.number(), y: z.number(), button: z.enum(['left', 'middle', 'right', 'none']).optional(), buttons: z.number().int().optional(), clickCount: z.number().int().min(0).max(3).optional(), modifiers: mods }),
  z.object({ type: z.literal('wheel'), x: z.number(), y: z.number(), deltaX: z.number(), deltaY: z.number(), modifiers: mods }),
  z.object({ type: z.literal('key'), event: z.enum(['keyDown', 'keyUp']), key: z.string().max(40), code: z.string().max(40), text: z.string().max(4).optional(), keyCode: z.number().int(), modifiers: mods }),
  z.object({ type: z.literal('text'), text: z.string().max(10_000) }),
]);

/**
 * One event, or `{events}` in order. A batch goes out to Chrome at once and the reply waits for
 * all of it, so a client queues (and merges moves and scrolls) while Chrome catches up.
 */
browserApi.post('/:id/browser/input', async (c) => {
  const b = browserFor(c);
  if (!b.running) return c.json({ error: 'The browser is not running' }, 409);
  const body = await c.req.json();
  const events = (body && Array.isArray(body.events) ? z.array(browserInput).max(200).parse(body.events) : [browserInput.parse(body)]) as BrowserInput[];
  await Promise.all(events.map((e) => b.input(e)?.catch(() => {})));
  return c.json({ ok: true });
});

/** The page's selected text, for Cmd-C in the panel. */
browserApi.post('/:id/browser/copy', async (c) => {
  const b = browserFor(c);
  if (!b.running) return c.json({ text: '' });
  return c.json({ text: await b.selection().catch(() => '') });
});

browserApi.post('/:id/browser/action', async (c) => {
  const b = browserFor(c);
  const body = z
    .discriminatedUnion('action', [
      z.object({ action: z.literal('navigate'), url: z.string().max(4000) }),
      z.object({ action: z.enum(['back', 'forward', 'reload', 'stop', 'start', 'restart']) }),
      z.object({ action: z.literal('newTab'), url: z.string().max(4000).optional() }),
      z.object({ action: z.enum(['tab', 'closeTab']), id: z.string().max(100) }),
      z.object({ action: z.literal('resize'), width: z.number(), height: z.number(), scale: z.number().optional() }),
    ])
    .parse(await c.req.json());
  if (body.action === 'restart') b.close();
  await b.start();
  switch (body.action) {
    case 'navigate': {
      const url = normalizeUrl(body.url);
      if (!url) return c.json({ error: 'Only http and https pages open here' }, 400);
      await b.navigate(url);
      break;
    }
    case 'newTab': {
      const url = body.url ? normalizeUrl(body.url) : 'about:blank';
      if (!url) return c.json({ error: 'Only http and https pages open here' }, 400);
      await b.newTab(url);
      break;
    }
    case 'back':
      await b.history(-1);
      break;
    case 'forward':
      await b.history(1);
      break;
    case 'reload':
      await b.reload();
      break;
    case 'stop':
      await b.stopLoading();
      break;
    case 'tab':
      await b.attach(body.id);
      break;
    case 'closeTab':
      await b.closeTab(body.id);
      break;
    case 'resize':
      await b.resize(body.width, body.height, body.scale);
      break;
    case 'start':
    case 'restart':
      break;
    default: {
      const _exhaustive: never = body;
      throw new Error(_exhaustive);
    }
  }
  return c.json(b.state());
});
