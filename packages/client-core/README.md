# Omni client core

This package gives the iOS app a typed HTTP client and a bounded thread stream. It does not pair a device or store credentials. Supply the server URL and a token provider from the pairing/session layer.

## Connect

Install an EventSource implementation that supports request headers, such as `react-native-sse`. The browser's native EventSource cannot send bearer headers. It can use a paired cookie instead.

```ts
import EventSource from 'react-native-sse';
import {
  apiPath, createHttpClient, createOmniApi, eventSourceTransport,
  openThreadLive, parseBaseUrl, type HistoryEvent, type ThreadOpen,
} from '@omni/client-core';

const baseUrl = parseBaseUrl(serverUrl);
if (!baseUrl) throw new Error('Invalid server URL');
const token = () => sessionStore.getToken();
const http = createHttpClient({ baseUrl, token });
const api = createOmniApi(http);
const transport = eventSourceTransport(EventSource);

const live = await openThreadLive<HistoryEvent, ThreadOpen>({
  load: () => api.thread(threadId),
  streamUrl: after => http.url(apiPath`/threads/${threadId}/stream`, { after }),
  token,
  transport,
  refreshAuth: () => sessionStore.refresh(), // Return false if pairing is revoked.
  onDetail: detail => updateDetail(detail),
  onHistory: state => updateHistory(state.history),
  onOther: message => handleThreadMessage(message),
  onState: state => updateConnectionState(state),
});
```

`onDetail` receives the initial detail and every stream sync. A replay sync has an empty `events` array. Render the rows from `state.history`, not from the sync detail. `onOther` receives thread, artifact, context and other non-row messages. The history object is replaced on each update, but the `ThreadHistory` holder stays the same.

Call `live.stream.pause()` when the app backgrounds and `live.stream.resume()` when it returns. Call `live.stream.close()` when leaving the thread. Load an older page or fill a gap with `live.history.page`:

```ts
await live.history.page(cursor, query =>
  http.request('GET', apiPath`/threads/${threadId}/history`, { query }),
);
updateHistory(live.history.history);
```

Use `fullRow` with `api.event` for a clipped row. Import cursor types and helpers from `@omni/shared/history.ts`.

The global feed has no replay. Use `openFeed` with the same transport and token provider. Its `onReconnect` callback must refetch each visible global view. The first connection does not call `onReconnect`.

HTTP writes make one request. An offline or failed request rejects; the package does not queue or retry writes. Callers can pass a stable `request_id` to `sendMessage` when retrying an uncertain send. A 401 from HTTP is an `OmniHttpError`; the app owns session refresh and pairing UI. A request never follows a redirect: it is sent with `redirect: 'manual'`, and a 3xx, an `opaqueredirect`, or an answer whose `url` is on another origin fails as `{ kind: 'redirect' }` without its body being read. That keeps the bearer token with the server where `fetch` honors `manual`, and discards the other origin's answer where it does not (React Native). `timeoutMs` bounds a request, its body read included. The stream calls `refreshAuth` once on a reported 401 and enters `unauthorized` if refresh fails. An EventSource implementation must expose the HTTP status on its error event for that hook to run. While `refreshAuth` is pending the state is `connecting`, and `resume()` abandons a refresh that never settles and reconnects.

`api.artifacts()` lists the newest files. `api.artifactFile(artifact)` fetches one file's bytes through `http.requestBytes`, which takes the same token, redirect refusal and timeout as `request` and returns `{ bytes, contentType }`. It refuses a body past `ARTIFACT_MAX_BYTES` (25 MB) as a `decoding` failure, before reading it when `content-length` says so. The file's `updated_at` goes in the `v` query so a rewrite is a new URL.

Pass `follows` to `openThreadLive` and return false while the user reads older pages. Past 2,000 loaded rows, a live row then trims nothing the user is looking at, up to the 6,000 row hard limit. It defaults to true, which trims the oldest rows.

`eventSourceTransport` wraps `react-native-sse` so that a stream the server closes ends as an error and the client reconnects after its backoff. Version 1.2.1 otherwise ends such a stream silently, and the client would wait for its 50 second watchdog. The wrapper overrides `_pollAgain`, which is not public API. It leaves an implementation without that method unchanged. Recheck it when upgrading `react-native-sse`. That library also keeps the whole response in `responseText` for the life of one connection, so a long-lived stream grows in memory until the connection drops and reopens. Background pauses reset it, and the app can also call `pause()` then `resume()` on a long foreground session.

## Machines and continuing a thread

`handOff`, `takeOver`, `cancelHandoff`, `continuePreview`, `continueThread` and `closeTerminal` reject with an `OmniHttpError` when the server refuses. A refusal's parsed reply is `error.failure.body` on an `http` failure. For a 409 from `continueThread` that body is `{code: 'busy', block}`, `{code: 'changed', preview}` or `{code: 'request_reused'}`. Pass the error to `startError` from `@omni/shared/continue-flow.ts` to read it. The sheet's reducer, the Start body with its retry-stable request id, and the Machine chip's rows are in `@omni/shared/continue-flow.ts` and `@omni/shared/thread-machine.ts`, the same code the Web UI runs.

## Files

`sendMessage` and `createThread` take the files as a last argument: `api.sendMessage(id, { prompt, request_id }, { files, onProgress, signal })`. A file is `{ uri, name, type }`, the part React Native's `FormData` reads from disk when the request goes out. With no files the call is the plain JSON request. With files it is multipart: the JSON body in a `payload` field and one `files` field per file, as the server's `readBody` reads them. A retry must send the same files under the same `request_id`, or the server does not call it a retry.

`fetch` reports no upload progress in React Native. Pass `upload: xhrUploadTransport()` to `createHttpClient` and `onProgress` receives `{ sent, total }` as the body goes out. Without it uploads use `fetch` and never call `onProgress`. `signal` cancels either as `{ kind: 'cancelled' }`. The redirect guard applies to both. `XMLHttpRequest` follows a redirect itself, so a redirect to another origin is caught by the answer's `responseURL`, the same limit `fetch` has in React Native. `api.status()` reads `maxUploadMb`, the largest file the server takes.

## Protocol notes

The server replays rows after the last thread event ID when the missing rows fit its budget. Otherwise it sends a recent snapshot. Snapshot application keeps the old and new spans apart, so the app can page the gap. Event IDs are global and need not be consecutive. The client deduplicates rows by ID, not stream messages, because EventSource implementations carry the last ID onto later messages without an ID.

T3 Code uses Effect atoms for its mobile presentation state. This package keeps framework-independent history and stream objects instead. Omni already owns the history span operations in `@omni/shared`, and the iOS app can wrap their updates in its chosen state library without adding Effect to this package.

Server and integration limits:

- The server returns HTTP 500 for an unknown channel during thread creation, rather than a client-error status.
- The iOS scaffold and pairing service are separate work. No device runtime or pairing flow was tested here.
