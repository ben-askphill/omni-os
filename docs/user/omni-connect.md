# Omni Connect

Omni Connect opens your Omni from a phone or another computer without Tailscale. Your sync relay creates a Cloudflare tunnel for each machine that turns it on, at a hostname like `https://bens-macbook-a1b2c3.omni-os.app`. A Connect page on the relay lists those machines. Sign in there with Google once, and Open signs that browser in to any of them. Why it works this way: [ADR 0009](../adr/0009-omni-connect.md).

It is optional, and it needs the [sync relay](sync.md) sign-in first. It uses the same relay and the same Google account.

## Set it up

1. Give the relay its Cloudflare secrets. `npm run relay:config` prints them: `CF_API_TOKEN` (an API token with Account: Cloudflare Tunnel: Edit, and Zone: DNS: Edit on the zone), `CF_ACCOUNT_ID`, `CF_ZONE_ID` and `CONNECT_ZONE` (`omni-os.app`). Set them with `npx wrangler secret put` or `npx wrangler secret bulk` from `apps/relay`. Without them the relay answers 503 `connect_not_configured` to Connect calls, and sync keeps working.
2. Install `cloudflared` on each machine: `brew install cloudflared`. Omni looks on `PATH` and in Homebrew's folders. Set `OMNI_CLOUDFLARED` to its path if it is somewhere else. Omni never downloads it.
3. On each machine, turn it on in Settings, Omni Connect. The Conductor can do the same with `omni_connect_set`, and `omni_connect_status` shows the hostname, the tunnel state and the machines.

Turning Connect on links the relay's Google account as this Omni's owner if none is linked yet. A machine linked to a different Google account refuses to turn Connect on.

## Open a machine from a phone

- Bookmark `<relay URL>/connect` (Settings, Omni Connect shows it). Sign in with Google there once. The relay keeps you signed in for 30 days. Tap Open next to a machine.
- Or open the machine's own `https://<name>-xxxxxx.omni-os.app` address and choose Open with Omni Connect on the pairing screen.

Either way the machine signs that browser in. The browser gets an ordinary signed-in device session, listed in Settings, Sharing & access with the other signed-in devices. Revoke it there like any other. Opening again later makes a new session.

## What to know

- The machine must be awake with Omni running. The Connect page shows a machine as offline when it does not answer within 5 seconds.
- The Connect hostname needs the token or a session on every route, as a `.ts.net` name does. The Tailscale login check (`integrations.tailscaleLogin`) does not apply there, because that request did not come through Tailscale.
- Turning Connect off deletes the machine's tunnel and DNS record on Cloudflare. Sessions it already made stay until you revoke them.
- Signing out of sync (Sign Out in Settings, Sync) also deletes the machine's tunnel on the relay.
- A machine's place on Connect belongs to it. Another machine signed in to the same relay cannot register it. When a machine signs in to sync again without signing out first, it gets its place back by signing with its own key. An Omni from before that change cannot, so update Omni on that machine first. A machine that lost its key, for example after its secret store was cleared, cannot register its old place again.
- The relay refuses a hostname whose DNS record it did not make for that machine (409 `hostname_taken`). Delete that record in Cloudflare if it is a leftover, or turn Connect off, rename the machine and turn it on again for a new hostname.
