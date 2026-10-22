# Remote access and security

## From your phone

Run the production server and put it on your tailnet:

```bash
npm run build && npm start
tailscale serve --bg 4747
```

Then open the `.ts.net` address Tailscale prints, on any device signed in to the same tailnet. The server itself stays on loopback; Tailscale is the door. The Mac has to be awake: `scripts/install-launchd.sh` keeps it from idle-sleeping while the server runs.

## Who can call the API

The network is the auth. The server binds `OMNI_HOST`, or `127.0.0.1` when that is unset, and Omni does not check a token. Anyone who can open the port can read threads, write Keychain entries via `POST /api/secrets`, merge PRs, and type into a thread shell. `tailscale serve` (above) is the supported remote path: the server stays on loopback, and the tailnet is the door.

The network being the auth only holds if a web page cannot use your browser as its way in. `apps/server/request-guard.ts` sits in front of every `/api` route and refuses:

- a `Host` that is not loopback, a `.ts.net` name, a 100.64.0.0/10 address, `OMNI_HOST` or one listed in `OMNI_ALLOWED_HOSTS` (comma-separated). This stops DNS rebinding.
- `Sec-Fetch-Site: cross-site`, and any `Origin` (`null` included) that is not the host the request came in on.
- `text/plain` and form-urlencoded bodies (415), the types a page can send without a CORS preflight.

The Mac app, `apps/mcp/omni.ts`, `scripts/omni.sh` and curl send no `Origin`, so only the `Host` check applies to them. HTML and SVG artifacts are served with `Content-Security-Policy: sandbox`, so a page opened in its own tab does not run on Omni's origin.
