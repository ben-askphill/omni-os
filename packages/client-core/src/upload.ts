// The two ways to send a multipart request. `fetchUpload` runs anywhere `fetch` does but cannot report progress.
// `xhrUploadTransport` is for React Native, whose `fetch` has no upload progress and whose XMLHttpRequest has.
import type { Fetch, FetchResponse, UploadFile, UploadInit, UploadTransport } from './http.ts';

/** What `FormData` is to these functions. React Native's accepts a `{ uri, name, type }` part, the web's takes a Blob. */
export interface FormLike {
  append(name: string, value: string | UploadFile): void;
}
export type FormFactory = () => FormLike;

const defaultForm: FormFactory = () => new FormData() as unknown as FormLike;

/** The body of `init`: `payload` as its own field, then every file under `files`, as `readBody` in the server reads them. */
export function multipartBody(init: Pick<UploadInit, 'payload' | 'files'>, form: FormFactory = defaultForm): FormLike {
  const body = form();
  body.append('payload', init.payload);
  for (const file of init.files) body.append('files', { uri: file.uri, name: file.name, type: file.type });
  return body;
}

/**
 * Sends with `fetch`. The content type is left out so the platform adds the multipart boundary. `Fetch` types its
 * body as a string, which is all the JSON calls send, so the form goes through a cast.
 */
export function fetchUpload(send: Fetch, form: FormFactory = defaultForm): UploadTransport {
  return (url, init) =>
    send(url, { method: init.method, headers: init.headers, body: multipartBody(init, form) as unknown as string, signal: init.signal, redirect: init.redirect });
}

/** The part of XMLHttpRequest the transport uses. */
export interface XhrLike {
  readonly upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null };
  readonly status: number;
  readonly responseText: string;
  readonly responseURL: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  getResponseHeader(name: string): string | null;
  send(body: unknown): void;
  abort(): void;
}

const abortError = () => Object.assign(new Error('The upload was cancelled'), { name: 'AbortError' });

/**
 * Sends with XMLHttpRequest and reports how much of the body has gone out. XMLHttpRequest follows redirects itself,
 * so the redirect guard in `createHttpClient` works from `responseURL`: an answer from another origin is refused
 * unread. A cancel through `init.signal` aborts the request.
 */
export function xhrUploadTransport(makeXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike, form: FormFactory = defaultForm): UploadTransport {
  return (url, init) =>
    new Promise<FetchResponse>((resolve, reject) => {
      if (init.signal?.aborted) {
        reject(abortError());
        return;
      }
      const xhr = makeXhr();
      const cancel = () => xhr.abort();
      const done = () => init.signal?.removeEventListener('abort', cancel);
      xhr.open(init.method, url);
      for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) init.onProgress?.({ sent: e.loaded, total: e.total });
      };
      xhr.onload = () => {
        done();
        const text = xhr.responseText;
        resolve({ status: xhr.status, headers: { get: (name) => xhr.getResponseHeader(name) }, text: async () => text, url: xhr.responseURL });
      };
      xhr.onerror = () => {
        done();
        reject(new Error('Network request failed'));
      };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => {
        done();
        reject(abortError());
      };
      init.signal?.addEventListener('abort', cancel);
      xhr.send(multipartBody(init, form));
    });
}
