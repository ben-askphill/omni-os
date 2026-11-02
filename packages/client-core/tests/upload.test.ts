import { describe, expect, it } from 'vitest';
import { createOmniApi } from '../src/api/index.ts';
import { apiPath, createHttpClient, OmniHttpError, parseBaseUrl, type BaseUrl, type Fetch, type HttpFailure, type UploadFile, type UploadProgress } from '../src/http.ts';
import { fetchUpload, multipartBody, xhrUploadTransport, type FormLike, type XhrLike } from '../src/upload.ts';

const base = parseBaseUrl('http://127.0.0.1:4757') as BaseUrl;
const photo: UploadFile = { uri: 'file:///tmp/IMG_0001.jpg', name: 'IMG_0001.jpg', type: 'image/jpeg' };
const notes: UploadFile = { uri: 'file:///tmp/notes.pdf', name: 'notes.pdf', type: 'application/pdf' };

class Form implements FormLike {
  entries: Array<[string, string | UploadFile]> = [];
  append(name: string, value: string | UploadFile) {
    this.entries.push([name, value]);
  }
}
const form = () => new Form();

class FakeXhr implements XhrLike {
  upload: XhrLike['upload'] = { onprogress: null };
  status = 0;
  responseText = '';
  responseURL = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  opened: [string, string] | null = null;
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;
  responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, text: string, url = 'http://127.0.0.1:4757/api/threads/t1/messages') {
    this.status = status;
    this.responseText = text;
    this.responseURL = url;
    this.onload?.();
  }
}

const failureOf = async (p: Promise<unknown>): Promise<HttpFailure> => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OmniHttpError);
  return (err as OmniHttpError).failure;
};

describe('multipartBody', () => {
  it('puts the JSON in payload and every file under files, in order', () => {
    const body = multipartBody({ payload: '{"prompt":"look"}', files: [photo, notes] }, form) as Form;
    expect(body.entries).toEqual([
      ['payload', '{"prompt":"look"}'],
      ['files', photo],
      ['files', notes],
    ]);
  });

  it('sends only uri, name and type of a file', () => {
    const body = multipartBody({ payload: '{}', files: [{ ...photo, extra: 1 } as UploadFile] }, form) as Form;
    expect(Object.keys(body.entries[1]![1] as object).sort()).toEqual(['name', 'type', 'uri']);
  });
});

describe('http.upload over fetch', () => {
  function over() {
    const sent: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown; redirect: string; signal?: AbortSignal }> = [];
    const fetch: Fetch = async (url, init) => {
      sent.push({ url, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect, signal: init.signal });
      return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"id":"t1"}' };
    };
    return { sent, http: createHttpClient({ baseUrl: base, token: ' secret ', fetch, upload: fetchUpload(fetch, form) }) };
  }

  it('sends a bearer token, no content type and a form body that does not follow redirects', async () => {
    const { sent, http } = over();
    const out = await http.upload('POST', apiPath`/threads/${'t1'}/messages`, { payload: { prompt: 'look', request_id: 'r1' }, files: [photo] });
    expect(out).toEqual({ id: 't1' });
    const [call] = sent;
    expect(call!.url).toBe('http://127.0.0.1:4757/api/threads/t1/messages');
    expect(call!.method).toBe('POST');
    expect(call!.headers).toEqual({ accept: 'application/json', authorization: 'Bearer secret' });
    expect(call!.redirect).toBe('manual');
    expect((call!.body as unknown as Form).entries).toEqual([
      ['payload', JSON.stringify({ prompt: 'look', request_id: 'r1' })],
      ['files', photo],
    ]);
  });

  it('refuses a redirect and an answer from another origin', async () => {
    const redirect: Fetch = async () => ({ status: 302, headers: { get: () => null }, text: async () => '' });
    const http = createHttpClient({ baseUrl: base, token: 't', fetch: redirect, upload: fetchUpload(redirect, form) });
    expect(await failureOf(http.upload('POST', apiPath`/threads`, { payload: {}, files: [photo] }))).toEqual({ kind: 'redirect' });

    const elsewhere: Fetch = async () => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => '{}', url: 'https://evil.example/x' });
    const other = createHttpClient({ baseUrl: base, token: 't', fetch: elsewhere, upload: fetchUpload(elsewhere, form) });
    expect(await failureOf(other.upload('POST', apiPath`/threads`, { payload: {}, files: [photo] }))).toEqual({ kind: 'redirect' });
  });

  it('turns a 400 into the server message', async () => {
    const fetch: Fetch = async () => ({
      status: 400,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: '"big.mov" is 40.0 MB, over the 25 MB limit' }),
    });
    const http = createHttpClient({ baseUrl: base, token: 't', fetch, upload: fetchUpload(fetch, form) });
    expect(await failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo] }))).toMatchObject({
      kind: 'http',
      status: 400,
      message: '"big.mov" is 40.0 MB, over the 25 MB limit',
    });
  });

  it('reports a cancel through the signal as cancelled', async () => {
    const controller = new AbortController();
    const fetch: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const http = createHttpClient({ baseUrl: base, token: 't', fetch, upload: fetchUpload(fetch, form) });
    const pending = failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo], signal: controller.signal }));
    controller.abort();
    expect(await pending).toEqual({ kind: 'cancelled' });
  });

  it('times out an upload that never answers', async () => {
    const fetch: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const http = createHttpClient({ baseUrl: base, token: 't', fetch, upload: fetchUpload(fetch, form), timeoutMs: 5 });
    expect(await failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo] }))).toEqual({ kind: 'unreachable', detail: 'timed out' });
  });
});

describe('http.upload over XMLHttpRequest', () => {
  function over() {
    const xhrs: FakeXhr[] = [];
    const transport = xhrUploadTransport(() => {
      const x = new FakeXhr();
      xhrs.push(x);
      return x;
    }, form);
    const fetch: Fetch = async () => {
      throw new Error('fetch must not be used');
    };
    return { xhrs, http: createHttpClient({ baseUrl: base, token: 'secret', fetch, upload: transport }) };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('sends the request with its headers and body, and reads the answer', async () => {
    const { xhrs, http } = over();
    const pending = http.upload<{ id: string }>('POST', apiPath`/threads/t1/messages`, { payload: { prompt: 'p' }, files: [photo, notes] });
    await tick();
    const [x] = xhrs;
    expect(x!.opened).toEqual(['POST', 'http://127.0.0.1:4757/api/threads/t1/messages']);
    expect(x!.headers).toEqual({ accept: 'application/json', authorization: 'Bearer secret' });
    expect((x!.body as Form).entries.map(([name]) => name)).toEqual(['payload', 'files', 'files']);
    x!.answer(200, '{"id":"t1"}');
    expect(await pending).toEqual({ id: 't1' });
  });

  it('reports progress and ignores events without a length', async () => {
    const { xhrs, http } = over();
    const seen: UploadProgress[] = [];
    const pending = http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo], onProgress: (p) => seen.push(p) });
    await tick();
    const x = xhrs[0]!;
    x.upload.onprogress?.({ loaded: 10, total: 100, lengthComputable: true });
    x.upload.onprogress?.({ loaded: 20, total: 0, lengthComputable: false });
    x.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true });
    x.answer(200, '{}');
    await pending;
    expect(seen).toEqual([
      { sent: 10, total: 100 },
      { sent: 100, total: 100 },
    ]);
  });

  it('aborts the request on cancel and says cancelled', async () => {
    const { xhrs, http } = over();
    const controller = new AbortController();
    const pending = failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo], signal: controller.signal }));
    await tick();
    controller.abort();
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(xhrs[0]!.aborted).toBe(true);
  });

  it('does not start when the signal is already aborted', async () => {
    const { xhrs, http } = over();
    const controller = new AbortController();
    controller.abort();
    expect(await failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo], signal: controller.signal }))).toEqual({ kind: 'cancelled' });
    expect(xhrs).toHaveLength(0);
  });

  it('says unreachable on a network error', async () => {
    const { xhrs, http } = over();
    const pending = failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo] }));
    await tick();
    xhrs[0]!.onerror?.();
    expect(await pending).toMatchObject({ kind: 'unreachable' });
  });

  it('refuses an answer that came from another origin, though XMLHttpRequest followed the redirect', async () => {
    const { xhrs, http } = over();
    const pending = failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo] }));
    await tick();
    xhrs[0]!.answer(200, '{}', 'https://evil.example/x');
    expect(await pending).toEqual({ kind: 'redirect' });
  });

  it('turns a 413 into an http failure', async () => {
    const { xhrs, http } = over();
    const pending = failureOf(http.upload('POST', apiPath`/threads/t1/messages`, { payload: {}, files: [photo] }));
    await tick();
    xhrs[0]!.answer(413, '{"error":"too big"}');
    expect(await pending).toMatchObject({ kind: 'http', status: 413, message: 'too big' });
  });
});

describe('sending with files through the api', () => {
  function recorded() {
    const calls: Array<{ upload: boolean; path: string; method: string; body?: unknown }> = [];
    const fetch: Fetch = async (url, init) => {
      calls.push({ upload: typeof init.body !== 'string' && init.body !== undefined, path: url, method: init.method, body: init.body });
      return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"id":"t1"}' };
    };
    return { calls, api: createOmniApi(createHttpClient({ baseUrl: base, token: 't', fetch, upload: fetchUpload(fetch, form) })) };
  }

  it('keeps sendMessage plain JSON without files', async () => {
    const { calls, api } = recorded();
    await api.sendMessage('t1', { prompt: 'hi', request_id: 'r1' });
    await api.sendMessage('t1', { prompt: 'hi', request_id: 'r1' }, { files: [] });
    expect(calls.map((c) => c.upload)).toEqual([false, false]);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ prompt: 'hi', request_id: 'r1' });
  });

  it('sends sendMessage as multipart with files', async () => {
    const { calls, api } = recorded();
    await api.sendMessage('t1', { prompt: 'look', request_id: 'r1' }, { files: [photo] });
    expect(calls[0]!.upload).toBe(true);
    expect((calls[0]!.body as unknown as Form).entries[0]).toEqual(['payload', JSON.stringify({ prompt: 'look', request_id: 'r1' })]);
  });

  it('sends createThread as multipart with files, carrying the client id', async () => {
    const { calls, api } = recorded();
    await api.createThread({ id: 'c1', channel_id: 'ch', prompt: 'look' } as never, { files: [photo, notes] });
    expect(calls[0]).toMatchObject({ upload: true, method: 'POST', path: 'http://127.0.0.1:4757/api/threads' });
    expect((calls[0]!.body as unknown as Form).entries.filter(([n]) => n === 'files')).toHaveLength(2);
  });

  it('reads the upload limit from the status', async () => {
    const fetch: Fetch = async () => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => '{"maxUploadMb":25,"running":0}' });
    const api = createOmniApi(createHttpClient({ baseUrl: base, token: 't', fetch }));
    expect((await api.status()).maxUploadMb).toBe(25);
  });
});
