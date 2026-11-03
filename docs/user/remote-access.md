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

Open that link on the phone (AirDrop it, or paste it). Or open the `.ts.net` address and paste the token from `data/api-token` into the pairing screen. Once a Google account is linked (below), the pairing screen also offers Sign in with Google, so a new device needs no token at all. The server itself stays on loopback; Tailscale is the door. The Mac has to be awake: the server keeps it from idle-sleeping while it runs, so leave the Omni app open.

Every client names the Mac its Omni runs on: the desktop sidebar's footer (in a browser and in the desktop app) and the phone's Channels and Settings headers. A browser on another device gets a Remote chip, and its tab title starts with that Mac's name.

On an iPhone, open the `.ts.net` address in Safari and use Share, then Add to Home Screen. Omni then opens full screen with the phone layout: Activity, Channels, Library and PRs tabs, and a + button for a new delegation. A home-screen app can keep its own cookies apart from Safari's, so if it opens on the pairing screen, paste the token there once.

## Pair the native iOS app

In Settings, open Sharing & access and choose Omni for iOS. Pairing takes the install token, so use the desktop app or a browser paired with the install token. A browser that signed in with Google shows where to go instead of a code.

Pick the address the phone will use. The card offers this page's address when it is HTTPS, then the Omni Connect address while the tunnel is connected. For Tailscale, run `tailscale serve --bg 4747`, open "Use another address" and enter your `.ts.net` name. The card cannot check that the phone reaches an address you typed.

Scan the QR code or type the manual code in the app. The code expires after five minutes and works once. The phone gets its own revocable app session, not the install token. Revoke a session under signed-in devices. A paired phone has the same access as a Google session, including the terminal and agents, so revoking does not undo commands it already ran.

## Without Tailscale

[Omni Connect](omni-connect.md) gives each machine a Cloudflare tunnel and a public `https://<name>-xxxxxx.omni-os.app` address, through your sync relay. Sign in with Google once on the relay's Connect page, then open any machine from there. Every request still needs the token or a session.

## The phone layout

Below 768px, the Web UI uses its phone layout, whether opened in a browser or saved to the home screen.

- Activity shows the desktop Inbox view's list: pinned threads, the threads waiting on you, and the Working and Done shelves (see [Threads](threads.md#finding-threads-and-clearing-needs-you)). Tap a row to open its thread. Its check marks it done, and the undo on a Done row puts it back.
- Channels groups clients, internal and personal channels. A channel shows collapsible folders and ungrouped threads in Active and Recent tabs. Active means Needs you or running; both tab counts include folded folders. Folder order and context menus are managed on desktop.
- Library lists artifacts with thumbnails. Open one full screen to read or share it.
- PRs lists the pull requests of every channel with a GitHub repo. Search matches title, number, author, branch and repo (and `label:` tokens); sort and filters narrow the list; rows group into Authored, Review requested and Others for your `gh` login. Tap one to open it on GitHub. Desktop web and the desktop app show the same list at `#/prs`. A repo gh cannot read is named under the list and the rest still show.
- The + button starts a thread with the Conductor or a channel, with model and effort choices, attachments and dictation.

A thread shows each prompt and answer before its folded steps; tap the step count to open them. Thread options opens Details, PRs, Changes, Browser, Terminal or Actions full screen. Details has the branch card and agents; the PRs screen lists the branch's pull requests, Watch PR, checks and a slide to squash and merge. Browser is watch-only and supports annotations. Terminal is read-only with tap-to-select output for a message. Automations, Secrets, Sync, Storage and settings pages without a phone-specific screen use the desktop page under a back bar.

Links and reloads return to the same screen. Back uses the parent screen when there is no in-app history. Home-screen setup does not add iOS Live Activities or a lock-screen view.

## Sign in with Google

Link the Google account that owns this Omni once, and new devices sign in with it instead of the token. Each one gets a session of its own that you can see and revoke. Sign-in goes through Clerk ([ADR 0007](../adr/0007-google-sign-in-through-clerk.md)). Anyone with a Google account can make a Clerk account, but only the one linked to this install gets in.

1. On a device that already holds the token (the desktop app, or a paired browser), open Settings, Sharing & access, Google account, and choose Link Google account.
2. Omni shows a code and opens Clerk's sign-in page. Sign in with Google there, check the page shows the same code, and approve.
3. On a new device, open Omni and choose Sign in with Google on the pairing screen. Approve the code the same way, with the same account.

- Signed-in devices are listed under the account, with when each was last used. Revoke ends one; Sign out on the device you are using ends its own. A session unused for 90 days stops working.
- Only a device holding the token can link, change or unlink the account. Linking another account or unlinking signs out Google sessions. Native app pairing sessions and browsers holding the install token are not affected.
- Signing in needs Clerk and the network. A device that already signed in keeps working offline.
- Omni uses a shared Clerk instance by default. `integrations.clerkPublishableKey` and `integrations.clerkClientId` in `data/omni.config.json` (or `OMNI_CLERK_PUBLISHABLE_KEY` and `OMNI_CLERK_CLIENT_ID`) point it at your own. Its OAuth application must be public, with the device authorization grant turned on. Both values are public; Omni holds no Clerk secret key.
- The Conductor lists signed-in devices with `signed_in_devices` and revokes one with `revoke_signed_in_device`.

## Who can call the API

Every `/api` request needs this install's token, or the session of a device that signed in with Google (above). The server makes it on first start: 32 random bytes in `data/api-token`, mode 0600, so only your macOS account can read it (`OMNI_TOKEN` in the server's environment replaces it, for tests and throwaway servers). A file rather than the Keychain: the desktop app and shell scripts read it without a Keychain prompt, and the Keychain would guard it from the same account the file mode already lets in. Delete the file and restart the server to rotate it; every browser then pairs again.

| Client | How it sends the token |
| --- | --- |
| Desktop app | Reads `api-token` in its data dir. Before it attaches to whatever answers on the port, it asks `GET /api/auth/proof?nonce=` for an HMAC of the port and a fresh nonce, keyed with the token, so a program squatting on the port never gets the token or your secrets, even by relaying the nonce to an Omni on another port. Then it opens `http://127.0.0.1:<port>/api/auth/desktop-pair` in its window. The server sets the same cookie as `/pair` and redirects to `/`. The token is not in the URL. A request through Tailscale or any proxy header is refused, so a phone still pairs with the token |
| `scripts/omni.sh`, `npm run setup` | `OMNI_TOKEN`, else `data/api-token` |
| Threads | `OMNI_TOKEN` in their environment, next to `OMNI_URL`. Omni's MCP servers (`apps/mcp/omni.ts`, `apps/mcp/ask.ts`) get `OMNI_TOKEN_FILE`, a path, so no token is written into `mcp.json` |
| Web UI | Pairs once (below), then holds the token in a cookie. Or signs in with Google and holds its own session in an `HttpOnly` cookie, `omni_session_<port>` |
| MCP clients outside Omni | On this Mac, `apps/mcp/external/stdio.ts` reads `data/api-token`. Over HTTP, `/mcp` takes a Clerk access token for the linked Google account, or its own token, `data/mcp-token`, as a header or in the URL. See [Omni as an MCP server](external-mcp.md) |

The Web UI and its assets are served without the token and never contain it, so opening the page gets you only the pairing screen. Pairing sends the token once to `POST /api/auth/pair`, which answers with an `HttpOnly`, `SameSite=Strict` cookie on `/api` (`Secure` behind HTTPS). Page scripts never see it, and `EventSource` streams and images carry it. The token gets to a browser one of two ways:

- Paste it from `data/api-token` into the pairing screen.
- Open a link with `?pair=<token>` after the route, like `http://127.0.0.1:4747/#/?pair=...`. `scripts/omni.sh --pair` prints one. The page swaps it for the cookie and drops it from the address bar. The link holds the token itself, so share it only with your own devices.

Through `tailscale serve`, set `integrations.tailscaleLogin` in `data/omni.config.json` to your Tailscale login (comma-separate several) and requests must also carry a matching `Tailscale-User-Login` header, which `tailscale serve` sets from the peer's identity. A request counts as coming through it when its `Host` is a `.ts.net` or 100.64.0.0/10 name, or when it carries any proxy header (`X-Forwarded-Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Forwarded`, `Tailscale-User-Login`, `Tailscale-Funnel-Request`). `tailscale serve` always sets `X-Forwarded-Host` (`addProxyForwardedHeaders` in its `ipn/ipnlocal/serve.go`) and strips client-sent identity headers, so a peer that sends `Host: 127.0.0.1` is still asked for the login. Tagged nodes and other users then get a 403 even with the token. That is defense in depth: the token is the main control. The Omni Connect hostname skips this check, since its requests come through Cloudflare, not Tailscale.

The token stops other macOS accounts, other tailnet devices and anything else that reaches the port. It does not stop a web page from using a paired browser's cookie, so `apps/server/request-guard.ts` also refuses:

- a `Host` that is not loopback, a `.ts.net` name, a 100.64.0.0/10 address, this machine's [Omni Connect](omni-connect.md) hostname while Connect is on, `OMNI_HOST` or one listed in `OMNI_ALLOWED_HOSTS` (comma-separated). This stops DNS rebinding. The Cloudflare Tunnel name in `integrations.mcpPublicUrl` is not on this list: only `/mcp` and `/.well-known` answer to it.
- `Sec-Fetch-Site: cross-site`, and any `Origin` (`null` included) that is not the host the request came in on.
- `text/plain` and form-urlencoded bodies (415), the types a page can send without a CORS preflight.

The desktop app's port check, `apps/mcp/omni.ts`, `scripts/omni.sh` and curl send no `Origin`, so the `Host` and token checks apply to them. Without the token or a session every route answers 401, except `GET /api/auth/proof`, `GET /api/auth/desktop-pair` from this machine (a proxy or another machine is refused), the Google sign-in routes (`GET /api/auth/methods`, `POST /api/auth/google/start` and `POST /api/auth/google/poll`, which still get every other check above), `POST /api/hooks/github/<automation>`, which proves itself with GitHub's signature instead (see [GitHub webhooks](automations.md#github-webhooks)), and Omni Connect's `POST /api/connect/mint`, `/health` and `/redeem`, which prove themselves with the relay's signature or a one-time code and a key proof. HTML and SVG artifacts are served with `Content-Security-Policy: sandbox`, so a page opened in its own tab does not run on Omni's origin.
