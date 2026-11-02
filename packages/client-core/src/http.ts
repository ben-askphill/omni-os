// No retries and no offline queue: a request that fails throws once, and the caller decides what to do next.
import { fetchUpload } from './upload.ts';

/** A server address `parseBaseUrl` accepted: http or https, a host, an optional path prefix, no trailing slash. */
export type BaseUrl = string & { readonly __brand: 'BaseUrl' };

/** A path under /api whose interpolated values are percent-encoded. Only `apiPath` makes one. */
export type ApiPath = string & { readonly __brand: 'ApiPath' };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query parameters, `undefined` ones left out. A string is a query already encoded, as `@omni/shared`'s builders make. */
export type Query = Readonly<Record<string, string | number | undefined>> | string;

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** Present where the platform can hand over a body as bytes, which `requestBytes` needs. */
  arrayBuffer?(): Promise<ArrayBuffer>;
  /** Where the answer came from after any redirects. Empty or missing when the platform does not say. */
  url?: string;
  /** `opaqueredirect` is what a browser's fetch gives for a redirect it was told not to follow. */
  type?: string;
}

export type Fetch = (
  url: string,
  init: {
    method: HttpMethod;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    /** Always `manual`: a redirect is never followed, because the request may carry the bearer token. */
    redirect: 'manual';
  },
) => Promise<FetchResponse>;

/** A file on the device, as React Native's FormData takes it: the bytes stay where they are until the request reads them. */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export interface UploadProgress {
  /** Bytes of the request body sent so far. */
  sent: number;
  /** The whole body's size, multipart framing included. */
  total: number;
}

/** What an upload sends: the JSON `payload` field and one `files` part per file, as `readBody` in the server reads them. */
export interface UploadInit {
  method: 'POST' | 'PATCH';
  headers: Record<string, string>;
  payload: string;
  files: readonly UploadFile[];
  signal?: AbortSignal;
  /** Called as the body goes out. A transport that cannot tell never calls it. */
  onProgress?: (progress: UploadProgress) => void;
  /** Always `manual`, as for `Fetch`. */
  redirect: 'manual';
}

/** Sends a multipart request. `fetchUpload` and `xhrUploadTransport` (upload.ts) are the two this package makes. */
export type UploadTransport = (url: string, init: UploadInit) => Promise<FetchResponse>;

export interface HttpClientConfig {
  baseUrl: BaseUrl;
  /** Sent as `Authorization: Bearer`. A function is read again on every request. */
  token: string | null | (() => string | null | Promise<string | null>);
  fetch?: Fetch;
  /** Sends uploads. Defaults to `fetchUpload` over `fetch`, which reports no progress. */
  upload?: UploadTransport;
  /** Gives up on a request, its body read included, after this long. The request then fails as `unreachable`. */
  timeoutMs?: number;
}

export interface RequestOptions<T> {
  query?: Query;
  /** Sent as JSON. Leave it out for a request with no body. */
  body?: unknown;
  signal?: AbortSignal;
  /** Turns the decoded JSON into `T`, throwing when it does not fit. Without it the JSON is trusted to be `T`. */
  parse?: (json: unknown) => T;
}

/** A file the server sent as it is. */
export interface RawResponse {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface RawRequestOptions {
  query?: Query;
  signal?: AbortSignal;
  /** Refuses a longer body, by its Content-Length before it is read and by its size after. Fails as `decoding`. */
  maxBytes: number;
}

/** A multipart request: `payload` as JSON in its own field, then the files. */
export interface UploadOptions<T> extends Omit<RequestOptions<T>, 'body'> {
  payload: unknown;
  files: readonly UploadFile[];
  onProgress?: (progress: UploadProgress) => void;
}

/** Files to send with a call that takes a JSON body otherwise. With none, the call is the plain JSON request. */
export interface WithFiles {
  files: readonly UploadFile[];
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/** One call, JSON or multipart by whether there are files, so a caller has one path to retry. */
export function sendWithFiles<T>(http: HttpClient, method: 'POST', path: ApiPath, body: unknown, withFiles?: WithFiles): Promise<T> {
  if (!withFiles?.files.length) return http.request<T>(method, path, { body, signal: withFiles?.signal });
  return http.upload<T>(method, path, { payload: body, files: withFiles.files, onProgress: withFiles.onProgress, signal: withFiles.signal });
}

export type HttpFailure =
  /** No answer at all: the server is down, the address is wrong, or the connection dropped. */
  | { kind: 'unreachable'; detail: string }
  /** A non-2xx answer. `message` is the server's `{error}` or its text; `body` the parsed reply, for a 409's `code`. */
  | { kind: 'http'; status: number; message: string; body: unknown; retryAfter: string | null }
  /** A 2xx answer that is not JSON, like the Web UI's index.html for a path the server does not route. */
  | { kind: 'not-json'; status: number; contentType: string | null }
  /** JSON that does not parse, or that `parse` refused. */
  | { kind: 'decoding'; detail: string }
  | { kind: 'cancelled' }
  /** The server answered with a redirect, or the platform followed one to another origin. Refused: the token stays with the server. */
  | { kind: 'redirect' };

export class OmniHttpError extends Error {
  readonly failure: HttpFailure;
  constructor(failure: HttpFailure) {
    super(failureMessage(failure));
    this.name = 'OmniHttpError';
    this.failure = failure;
  }
}

function failureMessage(f: HttpFailure): string {
  switch (f.kind) {
    case 'unreachable':
      return 'Cannot reach the Omni server. Is it running?';
    case 'http':
      return f.message;
    case 'not-json':
      return `The server answered ${f.status} with ${f.contentType ?? 'no content type'}, not JSON.`;
    case 'decoding':
      return `The server sent data this app can't read: ${f.detail}`;
    case 'cancelled':
      return 'Cancelled.';
    case 'redirect':
      return 'The server redirected the request to another address. The app refuses to follow it.';
  }
}

/** The address a user typed or a pairing gave, or null when it is not an http(s) server address. */
export function parseBaseUrl(input: string): BaseUrl | null {
  const m = input.trim().match(/^(https?):\/\/([^/?#@\s]+)(\/[^?#\s]*)?$/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2]}${(m[3] ?? '').replace(/\/+$/, '')}` as BaseUrl;
}

/** `scheme://host[:port]` in lower case with a default port dropped, or null when `url` is not an absolute http(s) URL. */
export function originOf(url: string): string | null {
  const m = url.match(/^(https?):\/\/([^/?#\s]+)/i);
  if (!m || m[2].includes('@')) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(scheme === 'https' ? /:443$/ : /:80$/, '');
  return `${scheme}://${host}`;
}

/** Tag for API paths: apiPath`/threads/${id}/messages`. Each value is encoded, so an id with `/` or `?` stays one segment. */
export function apiPath(strings: TemplateStringsArray, ...values: (string | number)[]): ApiPath {
  const path = strings.reduce((out, s, i) => out + encodeURIComponent(String(values[i - 1])) + s);
  if (!path.startsWith('/')) throw new TypeError(`An API path starts with "/": ${path}`);
  return path as ApiPath;
}

function queryString(query: Query | undefined): string {
  if (query === undefined) return '';
  if (typeof query === 'string') return query.replace(/^\?/, '');
  return Object.entries(query)
    .flatMap(([k, v]) => (v === undefined ? [] : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`]))
    .join('&');
}

const isJson = (contentType: string | null) => {
  const media = contentType?.split(';')[0].trim().toLowerCase();
  return media === 'application/json' || !!media?.endsWith('+json');
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

function errorMessage(data: unknown, contentType: string | null, status: number): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' && (data as { error: string }).error) {
    return (data as { error: string }).error;
  }
  if (typeof data === 'string' && data && !contentType?.toLowerCase().startsWith('text/html')) return data.slice(0, 300);
  return `Request failed (${status})`;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface HttpClient {
  readonly baseUrl: BaseUrl;
  /** The full URL of `path`, for the event streams and files that make their own requests. */
  url(path: ApiPath, query?: Query): string;
  /** Sends one request and resolves with its JSON body. Every failure rejects with an `OmniHttpError`. */
  request<T = unknown>(method: HttpMethod, path: ApiPath, options?: RequestOptions<T>): Promise<T>;
  /** GETs a file, not JSON, with the same token, redirect refusal, timeout and errors as `request`. */
  requestBytes(path: ApiPath, options: RawRequestOptions): Promise<RawResponse>;
  /** Like `request`, with files. The same checks apply: no redirect is followed, and `signal` cancels it as `cancelled`. */
  upload<T = unknown>(method: 'POST' | 'PATCH', path: ApiPath, options: UploadOptions<T>): Promise<T>;
}

/**
 * A redirect is never followed. Where `fetch` honors `redirect: 'manual'` the redirect target is never contacted, so
 * the token cannot reach it. Where it does not (React Native's fetch ignores the option), the answer is still refused
 * when it did not come from the server's own origin, so nothing another origin sends is read.
 */
function redirected(res: FetchResponse, serverOrigin: string | null): boolean {
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return true;
  if (!res.url) return false;
  return originOf(res.url) !== serverOrigin;
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const send = config.fetch ?? (globalThis.fetch as unknown as Fetch);
  const sendUpload = config.upload ?? fetchUpload(send);
  const serverOrigin = originOf(config.baseUrl);

  const url = (path: ApiPath, query?: Query) => {
    const q = queryString(query);
    return `${config.baseUrl}/api${path}${q ? `?${q}` : ''}`;
  };

  interface Exchange<B> {
    status: number;
    contentType: string | null;
    retryAfter: string | null;
    body: B;
  }

  /**
   * One round trip: the headers, the redirect refusal, the timeout over the body read, and the translation of a
   * failed send into an `OmniHttpError`. `read` turns the response into the body the caller wants.
   */
  async function exchange<B>(
    method: HttpMethod,
    path: ApiPath,
    options: { query?: Query; body?: unknown; signal?: AbortSignal; files?: Omit<UploadOptions<unknown>, 'query' | 'signal' | 'parse'> },
    accept: string,
    read: (res: FetchResponse) => Promise<B>,
  ): Promise<Exchange<B>> {
    const { body, signal } = options;
    const headers: Record<string, string> = { accept };
    const token = typeof config.token === 'function' ? await config.token() : config.token;
    if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const files = options.files;

    // One controller covers the caller's signal and the timeout. The timer runs through the body read.
    const timeout = config.timeoutMs === undefined ? null : new AbortController();
    let timedOut = false;
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          timeout.abort();
        }, config.timeoutMs)
      : undefined;
    const onAbort = () => timeout?.abort();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);

    try {
      const target = url(path, options.query);
      const sendSignal = timeout ? timeout.signal : signal;
      const res = files
        ? await sendUpload(target, { method: method as 'POST' | 'PATCH', headers, payload: JSON.stringify(files.payload), files: files.files, signal: sendSignal, onProgress: files.onProgress, redirect: 'manual' })
        : await send(target, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: sendSignal,
            redirect: 'manual',
          });
      if (redirected(res, serverOrigin)) throw new OmniHttpError({ kind: 'redirect' });
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        retryAfter: res.headers.get('retry-after'),
        body: await read(res),
      };
    } catch (err) {
      if (err instanceof OmniHttpError) throw err;
      if (timedOut) throw new OmniHttpError({ kind: 'unreachable', detail: 'timed out' });
      if (signal?.aborted || (err as { name?: unknown } | null)?.name === 'AbortError') throw new OmniHttpError({ kind: 'cancelled' });
      throw new OmniHttpError({ kind: 'unreachable', detail: describe(err) });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  const isOk = (status: number) => status >= 200 && status <= 299;

  function httpError(status: number, text: string, contentType: string | null, retryAfter: string | null): OmniHttpError {
    const data = text ? parseJson(text) : null;
    return new OmniHttpError({ kind: 'http', status, message: errorMessage(data, contentType, status), body: data, retryAfter });
  }

  async function request<T>(method: HttpMethod, path: ApiPath, options: RequestOptions<T> & { files?: Omit<UploadOptions<T>, 'query' | 'signal' | 'parse'> } = {}): Promise<T> {
    const { status, contentType, retryAfter, body: text } = await exchange(method, path, options, 'application/json', (res) => res.text());
    if (!isOk(status)) throw httpError(status, text, contentType, retryAfter);
    if (!isJson(contentType)) throw new OmniHttpError({ kind: 'not-json', status, contentType });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new OmniHttpError({ kind: 'decoding', detail: describe(err) });
    }
    if (!options.parse) return json as T;
    try {
      return options.parse(json);
    } catch (err) {
      throw new OmniHttpError({ kind: 'decoding', detail: describe(err) });
    }
  }

  async function requestBytes(path: ApiPath, options: RawRequestOptions): Promise<RawResponse> {
    const tooLarge = () => new OmniHttpError({ kind: 'decoding', detail: `the file is larger than ${options.maxBytes} bytes` });
    const { status, contentType, retryAfter, body } = await exchange('GET', path, options, '*/*', async (res) => {
      if (!isOk(res.status)) return res.text();
      const length = Number(res.headers.get('content-length'));
      if (Number.isFinite(length) && length > options.maxBytes) throw tooLarge();
      if (!res.arrayBuffer) throw new OmniHttpError({ kind: 'decoding', detail: 'this platform cannot read a file body' });
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > options.maxBytes) throw tooLarge();
      return new Uint8Array(buffer);
    });
    if (typeof body === 'string') throw httpError(status, body, contentType, retryAfter);
    return { bytes: body, contentType };
  }

  const upload = <T>(method: 'POST' | 'PATCH', path: ApiPath, options: UploadOptions<T>) =>
    request<T>(method, path, { query: options.query, signal: options.signal, parse: options.parse, files: options });

  return { baseUrl: config.baseUrl, url, request, requestBytes, upload };
}
