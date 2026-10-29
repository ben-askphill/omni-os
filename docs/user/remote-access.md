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

Every client names the Mac its Omni runs on: the desktop sidebar's footer, the phone's Channels and Settings headers, and the Mac app's server line. A browser on another device gets a Remote chip, and its tab title starts with that Mac's name.

On an iPhone, open the `.ts.net` address in Safari and use Share, then Add to Home Screen. Omni then opens full screen with the phone layout: Activity, Channels and Library tabs, and a + button for a new delegation. A home-screen app can keep its own cookies apart from Safari's, so if it opens on the pairing screen, paste the token there once.

## Run your agents on another machine

Omni can run on a Linux box (or another Mac) while you keep using this Mac's app, the web UI and your phone. Every thread then runs there: its CLIs, worktrees, browser and terminal use that machine's CPU, memory and logins, and nothing runs on this Mac.

1. On the box: install Omni (see [install](install.md)), log in the harness CLIs there, start the server and put it on your tailnet with `tailscale serve --bg 4747`. Its address is `https://<box>.<tailnet>.ts.net`.
2. In the Mac app, open Settings > Connection. Under Remote server, set the URL to that address and paste the box's `data/api-token` as the token. The token goes into this Mac's login Keychain, one item per address (`com.omni-os.remote-token`), never into a file or UserDefaults. Then switch Use from This Mac to Remote. Filling in the URL alone changes nothing.
3. Web and phone: open the same `.ts.net` address and pair with the box's token, as in [From your phone](#from-your-phone).

With a remote server set, the app starts, stops and restarts nothing: Start, Stop and Restart are for the server on this Mac, which the app leaves alone. The footer reads the box's name and "Remote", and when the box does not answer the window says why (no token saved, token refused, or cannot reach it) with Check Again. Switch back to This Mac in Settings > Connection or the Server menu (the footer's menu) to use the server on this Mac again; the remote URL and token stay saved for the next switch.

- Only an `https` address counts. The token travels over the TLS that `tailscale serve` provides, so the app skips the port proof it uses on loopback: the certificate names the host, and the token is one you pasted for that host.
- The CLIs on the box need their own logins. For Claude Code, `claude setup-token` on the box gives a long-lived subscription token; save it as the global secret `CLAUDE_CODE_OAUTH_TOKEN`. Log Codex in on the box itself (`codex login --device-auth`) rather than copying `~/.codex/auth.json` from a Mac: both machines refreshing one login logs one of them out.
- What the box cannot do: build or run the Mac app, Swift tests and Mac screenshots. Do those on a Mac.
- If the box is off, so is Omni. Keep this Mac's install as a sync peer to fall back on.

## The phone layout

Below 768px, the Web UI uses its phone layout, whether opened in a browser or saved to the home screen.

- Activity puts Needs you cards first, then Running, Pinned, Recent threads and Done today. Answer a blocker from its card or tap it to open the thread.
- Channels groups clients, internal and personal channels. A channel shows collapsible folders and ungrouped threads in Active and Recent tabs. Active means Needs you or running; both tab counts include folded folders. Folder order and context menus are managed on desktop.
- Library lists artifacts with thumbnails. Open one full screen to read or share it.
- The + button starts a thread with the Conductor or a channel, with model and effort choices, attachments and dictation.

A thread shows each prompt and answer before its folded steps; tap the step count to open them. The thread menu opens Changes, PR, Browser, Terminal, Actions or Details full screen. The PR screen has checks and a slide to squash and merge. Browser is watch-only and supports annotations. Terminal is read-only with tap-to-select output for a message. Automations, Secrets, Sync, Storage and settings pages without a phone-specific screen use the desktop page under a back bar.

Links and reloads return to the same screen. Back uses the parent screen when there is no in-app history. Home-screen setup does not add iOS Live Activities or a lock-screen view.

## Who can call the API

Every `/api` request needs this install's token. The server makes it on first start: 32 random bytes in `data/api-token`, mode 0600, so only your macOS account can read it (`OMNI_TOKEN` in the server's environment replaces it, for tests and throwaway servers). A file rather than the Keychain: the Mac app and shell scripts read it without a Keychain prompt, and the Keychain would guard it from the same account the file mode already lets in. Delete the file and restart the server to rotate it; every browser then pairs again.

| Client | How it sends the token |
| --- | --- |
| Mac app | Reads `data/api-token` (or `OMNI_DATA_DIR`'s) and sends `Authorization: Bearer`. Before it attaches to whatever answers on the port, it asks `GET /api/auth/proof?nonce=` for an HMAC of the port and a fresh nonce, keyed with the token, so a program squatting on the port never gets the token or your secrets, even by relaying the nonce to an Omni on another port. It sends the token only to that server's exact host and port: images on any other URL load without it, and it never goes in a shared cookie store |
| `scripts/omni.sh`, `npm run setup` | `OMNI_TOKEN`, else `data/api-token` |
| Threads | `OMNI_TOKEN` in their environment, next to `OMNI_URL`. Omni's MCP servers (`apps/mcp/omni.ts`, `apps/mcp/ask.ts`) get `OMNI_TOKEN_FILE`, a path, so no token is written into `mcp.json` |
| Web UI | Pairs once (below), then holds the token in a cookie |

The Web UI and its assets are served without the token and never contain it, so opening the page gets you only the pairing screen. Pairing sends the token once to `POST /api/auth/pair`, which answers with an `HttpOnly`, `SameSite=Strict` cookie on `/api` (`Secure` behind HTTPS). Page scripts never see it, and `EventSource` streams and images carry it. The token gets to a browser one of two ways:

- Paste it from `data/api-token` into the pairing screen.
- Open a link with `?pair=<token>` after the route, like `http://127.0.0.1:4747/#/?pair=...`. `scripts/omni.sh --pair` prints one. The page swaps it for the cookie and drops it from the address bar. The link holds the token itself, so share it only with your own devices.

Through `tailscale serve`, set `integrations.tailscaleLogin` in `data/omni.config.json` to your Tailscale login (comma-separate several) and requests must also carry a matching `Tailscale-User-Login` header, which `tailscale serve` sets from the peer's identity. A request counts as coming through it when its `Host` is a `.ts.net` or 100.64.0.0/10 name, or when it carries any proxy header (`X-Forwarded-Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Forwarded`, `Tailscale-User-Login`, `Tailscale-Funnel-Request`). `tailscale serve` always sets `X-Forwarded-Host` (`addProxyForwardedHeaders` in its `ipn/ipnlocal/serve.go`) and strips client-sent identity headers, so a peer that sends `Host: 127.0.0.1` is still asked for the login. Tagged nodes and other users then get a 403 even with the token. That is defense in depth: the token is the main control.

The token stops other macOS accounts, other tailnet devices and anything else that reaches the port. It does not stop a web page from using a paired browser's cookie, so `apps/server/request-guard.ts` also refuses:

- a `Host` that is not loopback, a `.ts.net` name, a 100.64.0.0/10 address, `OMNI_HOST` or one listed in `OMNI_ALLOWED_HOSTS` (comma-separated). This stops DNS rebinding.
- `Sec-Fetch-Site: cross-site`, and any `Origin` (`null` included) that is not the host the request came in on.
- `text/plain` and form-urlencoded bodies (415), the types a page can send without a CORS preflight.

The Mac app, `apps/mcp/omni.ts`, `scripts/omni.sh` and curl send no `Origin`, so the `Host` and token checks apply to them. Without the token every route answers 401, except `GET /api/auth/proof` and `POST /api/hooks/github/<automation>`, which proves itself with GitHub's signature instead (see [GitHub webhooks](automations.md#github-webhooks)). HTML and SVG artifacts are served with `Content-Security-Policy: sandbox`, so a page opened in its own tab does not run on Omni's origin.
