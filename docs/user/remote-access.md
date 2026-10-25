# Remote access and security

## From your phone

Run the production server and put it on your tailnet:

```bash
npm run build && npm start
tailscale serve --bg 4747
```

Then pair the phone once. On the Mac, print a pairing link with the `.ts.net` address:

```bash
OMNI_URL=https://<your-mac>.<tailnet>.ts.net scripts/omni.sh --pair
```

Open that link on the phone (AirDrop it, or paste it). Or open the `.ts.net` address and paste the token from `data/api-token` into the pairing screen. The server itself stays on loopback; Tailscale is the door. The Mac has to be awake: `scripts/install-launchd.sh` keeps it from idle-sleeping while the server runs.

On an iPhone, open the `.ts.net` address in Safari and use Share, then Add to Home Screen. Omni then opens full screen with the phone layout: Activity, Channels and Library tabs, and a + button for a new delegation. A home-screen app can keep its own cookies apart from Safari's, so if it opens on the pairing screen, paste the token there once.

## The phone layout

Below 768px, the Web UI uses its phone layout, whether opened in a browser or saved to the home screen.

- Activity puts Needs you cards first, then Running, Pinned, Recent threads and Done today. Answer a blocker from its card or tap it to open the thread.
- Channels groups clients, internal and personal channels. A channel shows collapsible folders and ungrouped threads in Active and Recent tabs. Active means Needs you or running; both tab counts include folded folders. Folder order and context menus are managed on desktop.
- Library lists artifacts with thumbnails. Open one full screen to read or share it.
- The + button starts a thread with the Conductor or a channel, with model and effort choices, attachments and dictation.

A thread shows each prompt and answer before its folded steps; tap the step count to open them. The thread menu opens Changes, PR, Browser, Terminal, Actions or Details full screen. The PR screen has checks and a slide to squash and merge. Browser is watch-only and supports annotations. Terminal is read-only with tap-to-select output for a message. Automations, Secrets, Sync, Storage and settings pages without a phone-specific screen use the desktop page under a back bar.

Links and reloads return to the same screen. Back uses the parent screen when there is no in-app history. Home-screen setup does not add iOS Live Activities or a lock-screen view.

## Who can call the API

Every `/api` request needs this install's token, or a session from [signing in with Google](google-sign-in.md). The server makes it on first start: 32 random bytes in `data/api-token`, mode 0600, so only your macOS account can read it (`OMNI_TOKEN` in the server's environment replaces it, for tests and throwaway servers). A file rather than the Keychain: the Mac app and shell scripts read it without a Keychain prompt, and the Keychain would guard it from the same account the file mode already lets in. Delete the file and restart the server to rotate it; every browser then pairs again.

| Client | How it sends the token |
| --- | --- |
| Mac app | Reads `data/api-token` (or `OMNI_DATA_DIR`'s) and sends `Authorization: Bearer`. Before it attaches to whatever answers on the port, it asks `GET /api/auth/proof?nonce=` for an HMAC of the port and a fresh nonce, keyed with the token, so a program squatting on the port never gets the token or your secrets, even by relaying the nonce to an Omni on another port. It sends the token only to that server's exact host and port: images on any other URL load without it, and it never goes in a shared cookie store |
| `scripts/omni.sh`, `npm run setup` | `OMNI_TOKEN`, else `data/api-token` |
| Threads | `OMNI_TOKEN` in their environment, next to `OMNI_URL`. Omni's MCP servers (`apps/mcp/omni.ts`, `apps/mcp/ask.ts`) get `OMNI_TOKEN_FILE`, a path, so no token is written into `mcp.json` |
| Web UI | Signs in with Google (a session cookie of its own, revocable per device), or pairs once (below) and holds the token in a cookie |

The Web UI and its assets are served without the token and never contain it, so opening the page gets you only the pairing screen. Pairing sends the token once to `POST /api/auth/pair`, which answers with an `HttpOnly`, `SameSite=Strict` cookie on `/api` (`Secure` behind HTTPS). Page scripts never see it, and `EventSource` streams and images carry it. The token gets to a browser one of two ways:

- Paste it from `data/api-token` into the pairing screen.
- Open a link with `?pair=<token>` after the route, like `http://127.0.0.1:4747/#/?pair=...`. `scripts/omni.sh --pair` prints one. The page swaps it for the cookie and drops it from the address bar. The link holds the token itself, so share it only with your own devices.

Through `tailscale serve`, set `integrations.tailscaleLogin` in `data/omni.config.json` to your Tailscale login (comma-separate several) and requests must also carry a matching `Tailscale-User-Login` header, which `tailscale serve` sets from the peer's identity. A request counts as coming through it when its `Host` is a `.ts.net` or 100.64.0.0/10 name, or when it carries any proxy header (`X-Forwarded-Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Forwarded`, `Tailscale-User-Login`, `Tailscale-Funnel-Request`). `tailscale serve` always sets `X-Forwarded-Host` (`addProxyForwardedHeaders` in its `ipn/ipnlocal/serve.go`) and strips client-sent identity headers, so a peer that sends `Host: 127.0.0.1` is still asked for the login. Tagged nodes and other users then get a 403 even with the token. That is defense in depth: the token is the main control.

The token stops other macOS accounts, other tailnet devices and anything else that reaches the port. It does not stop a web page from using a paired browser's cookie, so `apps/server/request-guard.ts` also refuses:

- a `Host` that is not loopback, a `.ts.net` name, a 100.64.0.0/10 address, `OMNI_HOST` or one listed in `OMNI_ALLOWED_HOSTS` (comma-separated). This stops DNS rebinding.
- `Sec-Fetch-Site: cross-site`, and any `Origin` (`null` included) that is not the host the request came in on.
- `text/plain` and form-urlencoded bodies (415), the types a page can send without a CORS preflight.

The Mac app, `apps/mcp/omni.ts`, `scripts/omni.sh` and curl send no `Origin`, so the `Host` and token checks apply to them. A Google session gets exactly the checks the token's cookie gets. Without the token or a session every route answers 401, except `GET /api/auth/proof`, the routes that start and finish a Google sign-in (`GET /api/auth/google`, `POST /api/auth/google/start` and `/finish`) and `POST /api/hooks/github/<automation>`, which proves itself with GitHub's signature instead (see [GitHub webhooks](automations.md#github-webhooks)). The credential-free routes still refuse other sites. Google's redirect back, `GET /api/auth/google/callback` (from Google, or from the OAuth broker), comes from another site by design, so it skips the cross-site and token checks and keeps the `Host` and Tailscale login checks; only the one-time sign-in state and the browser's binding cookie make it do anything.

A session can do anything the token can, including starting a thread that reads `data/api-token`. Revoking a device (Settings > Devices) stops that browser; if you think one was stolen while it worked, rotate the token as well. HTML and SVG artifacts are served with `Content-Security-Policy: sandbox`, so a page opened in its own tab does not run on Omni's origin.
