# Native app pairing contract

This contract describes version 1 of the native app pairing API. All routes are relative to the selected server's HTTPS origin. The server's existing host, origin, and request validation rules still apply. API errors are JSON objects with an `error` string. Shared TypeScript types live in `packages/shared/app-pairing.ts`.

## Pair a device

`POST /api/auth/app-pairings` requires the install token. It accepts an empty JSON object and returns `{ "code": "...", "expiresAt": "..." }`. The expiry is an ISO 8601 timestamp. Codes expire after 300 seconds and can be redeemed once. The server returns 429 with `Retry-After` when the creation limit is reached.

The QR payload is a JSON object with `version` set to `1`, `serverUrl` set to the server's HTTPS origin, and `code` set to the one-time code. It contains neither the install token nor the resulting app session token. Treat the code as a secret until it expires or is redeemed.

`serverUrl` is an HTTPS origin that the phone can reach from outside the computer. The settings card offers the origin of the page it is on, the Omni Connect address while its tunnel is connected, and an address the person types in, such as a Tailscale name. It never offers `localhost`, an IP address, a name without a dot, or a `.local` name. The server does not choose or check the address, so a client must show the person which address the QR names.

`POST /api/auth/app-pairings/redeem` requires no session. Send `{ "code": "...", "name": "..." }`, where `name` has 1 to 100 characters. The response is `{ "token": "...", "sessionId": "..." }`. Store the token in the phone's secure storage for that server, and send it as `Authorization: Bearer <token>` on subsequent requests. Invalid input returns 400. A missing, used, or expired code returns 404. Rate limits return 429 with `Retry-After`.

## Capabilities

`GET /api/capabilities` requires authentication. A version 1 response has this shape:

```json
{
  "api": 1,
  "auth": { "via": "session", "method": "pairing", "sessionId": "..." },
  "pairing": { "app": true, "codeTtlSeconds": 300 },
  "push": { "registration": true, "delivery": false },
  "streams": { "sse": true, "closeOnRevoke": true }
}
```

For install-token authentication, `auth.via` is `token`, and `auth.method` and `auth.sessionId` are null. A Google session has `auth.method` set to `google`. `push.delivery` is `true` only when the server has an APNs key (see Push delivery). Clients must reject API versions they do not support rather than assume an unknown response is compatible.

## Sessions

`GET /api/auth/devices` lists sessions, including the `method` field (`google` or `pairing`). `DELETE /api/auth/devices/:id` revokes one session. The install token and Google sessions can revoke any session. A pairing session can revoke only itself and gets 403 for any other id. `POST /api/auth/signout` revokes the caller's session. Only requests that carry the install token can call `POST /api/auth/pair`, so a session cannot swap itself for the install token. A revoked session cannot make subsequent HTTP requests, and its open SSE connections close. Sessions expire after 90 days without an authenticated request. An open SSE connection does not count as an authenticated request after it starts. The server checks open streams for expired sessions every 15 seconds. A pairing session is local to the selected server and does not require a linked Google account. Linking or unlinking a Google account does not revoke pairing sessions.

## Push registration

`PUT /api/auth/push-token` requires an app session and returns 401 if the session ended while the request was in flight. Send `token`, a hexadecimal APNs device token, `platform: "ios"`, `environment: "sandbox"` or `"production"`, and an optional `bundleId`. Registering again replaces that session's registration. The server associates a token with at most one session.

`GET /api/auth/push-token` returns whether a token is registered and its metadata, but never returns the token. `DELETE /api/auth/push-token` removes the registration and is idempotent. Revoking a session removes its registration. A registration sends nothing by itself; the server uses it only when `push.delivery` is `true`. A push is a wake-up signal; HTTP and SSE remain the source of truth.

## Push delivery

The server sends alerts directly to Apple with the team's APNs key, a `.p8` file over HTTP/2. It does not use Expo or the relay. The triggers, device sessions and revocation all live on the server, and a relay sender would need its own copy of that state. The sync relay holds change logs and machine tokens. It has no record of app sessions or alert choices.

Set these in the secret store (Keychain, libsecret or `data/secrets.json`), or as environment variables with the same names:

- `APNS_AUTH_KEY`: the `.p8` file's PEM text. Literal `\n` sequences are read as newlines.
- `APNS_KEY_ID`: the ten-character id of that key.
- `APNS_TEAM_ID`: the Apple developer team id.
- `APNS_BUNDLE_ID`: optional. Defaults to `app.omni-os.ios`.

With any of the first three missing, or the key unreadable, nothing is sent and `push.delivery` is `false`. The server logs once at startup which names are missing, never their values. Restart the server after changing them.

Each registration names its environment, and each request goes to the matching APNs host (`sandbox` or `production`). Alerts expire after 15 minutes. APNs answers every request, so there are no receipts to poll.

Alerts go out on these events:

- `needsInput`: the agent asks a question and waits for an answer.
- `finished`: a turn ends with the thread done. A finished child thread does not alert, because its parent gets the crew report.
- `failed`: a turn ends with an error, or Omni cannot prepare the thread's worktree. A failed child does alert.
- `crewReport`: a crew report lands in a Conductor thread. A report in any other channel does not alert.

A stopped turn, a queued turn and a turn cut short by Omni shutting down do not alert.

The payload has a fixed title and body, plus `kind`, `threadId` and `channelId`. It never carries a prompt, a question, a thread title, a reply or a code.

How each APNs answer is handled:

| Answer | Action |
|---|---|
| 200 | Delivered. |
| 410, or 400 `BadDeviceToken` | Token removed. Not retried. |
| 403 `ExpiredProviderToken` | New provider token signed, and the alert retried once. |
| 429, 5xx, or no answer | Retried after 0.5 s, then 1 s, then dropped. |
| Any other refusal | Dropped and logged. The token stays. |

A session revoked before an attempt gets no further attempts.

## Push preferences

`GET /api/auth/push-preferences` returns the device's choices: `{ "needsInput": true, "finished": true, "failed": true, "crewReport": true }`. Every kind is on until the device turns it off.

`PUT /api/auth/push-preferences` changes only the keys it sends and returns the full set. The body takes any of the four keys, each `true` or `false`. It must name at least one key and no other field. Anything else gets 400. Only app sessions may call either route (403 otherwise). A revoked session gets 401. The choices are removed with the session, as its token is.

The shared types are `AppPushKind`, `AppPushPreferences` and `AppPushPreferencesUpdate` in `packages/shared/app-pairing.ts`.

## What revoking does and does not stop

A pairing session has the same API access as a Google session. It can open the thread terminal and start agents, and both run code as the user who runs the server. That code can read `data/api-token`, and every agent receives the install token in its environment. Revoking a session ends that token's access to HTTP and SSE. It does not undo what the session already ran, and it does not remove anything that code installed.

So revoke protects against a lost or stolen token that nobody has used yet. For a device that has already run commands, revoke it, then rotate the install token and check the machine. The API has no route-level limit for pairing sessions, because the terminal, threads, automations and mods all run code. A reduced-capability session would need an allowlist of routes. That is a product decision this contract does not make.

## Notes for the iOS client

- Store the session token in the Keychain, one entry per server. Never put it in `UserDefaults`, logs or crash reports.
- Take `serverUrl` from the QR and use only that origin. Do not follow redirects to another origin with the token.
- Call `GET /api/capabilities` after pairing and on each launch. If `api` is not a version the app supports, stop and tell the person to update the app or the server.
- Treat a 401 from any request or SSE connection as the end of the session. Delete the token and the cached data for that server and show the pairing screen. Do not retry.
- Register the push token after pairing and again when APNs gives a new one. Registering again replaces the old one. Delete it on sign-out.
- Send the native APNs device token as lowercase or uppercase hex, with `environment` matching the build (`sandbox` for development builds, `production` for TestFlight and the App Store). The server does not accept Expo push tokens.
- Ask for notification permission before registering. Without it there is no token to send.
- A push only tells the app to fetch. Read state over HTTP and SSE.
- A tapped alert carries `omni.threadId` and `omni.channelId`. Open that thread, fetching it over HTTP first.
- Show the choices from `GET /api/auth/push-preferences` and change them with `PUT`, sending only the keys that changed.
- A code works once. If redeeming fails with 404, ask for a new code. If it fails with 429, wait for `Retry-After`.
