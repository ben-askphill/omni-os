# Sign in with Google

Google sign-in lets a browser or the Mac app into Omni without the install token. Google only says who you are. If that verified address is on this install's allowlist, Omni gives that browser or Mac its own session, which Settings > Devices lists and can revoke one at a time (`GET` and `DELETE /api/auth/devices`, or the Conductor's `signed_in_devices` and `revoke_device` tools). The install token (`data/api-token`) keeps working beside it for the Mac app's server check, scripts, agents and recovery. See [Remote access and security](remote-access.md) for the token.

Sign-in is off until you set it up. Nothing here sends Omni's data to Google: the scopes are `openid email profile`, and Omni keeps no Google token once it has checked who signed in.

## How it works

1. You click Sign in with Google. Omni opens Google's sign-in page with a one-time state, a nonce and a PKCE challenge.
2. Google sends your browser back with a code to `GET /api/auth/google/callback` on Omni, which takes it only from the browser that started (a binding cookie set at the start):
   - On the Mac that runs Omni (`localhost`, `127.0.0.1`), Google redirects there itself. Google's Desktop app clients accept any loopback port.
   - From anywhere else, like a phone over Tailscale, Google can only return to a fixed HTTPS address. That is the OAuth broker, a small Supabase Edge Function (`supabase/functions/omni-oauth-broker`). Omni puts its own address in the sign-in's `state`, and the broker sends your browser on to it if that address is on the broker's list. The broker stores nothing.
3. Omni trades the code with Google itself, checks the ID token (Google's signature, issuer, your client id, expiry, the nonce, a verified address) and the allowlist, then sets a session cookie for that browser (`omni_session_<port>`, HttpOnly, SameSite=Strict, on `/api`). A browser that signs in this way drops its install-token cookie, so revoking its session really signs it out.

A sign-in finishes only in the browser (or Mac app) that started it, once, within 10 minutes. So a Google link someone sends you cannot sign them in as you: your browser comes back without their binding cookie and Omni refuses the code. The broker sees the code in passing but never the PKCE verifier, the client secret or the install token, so it cannot use it.

Sessions last 30 days from the last use. Each sign-in is its own device, and signing in again in the same browser signs its old session out. Taking an address off the allowlist locks its sessions out at once, and they stop renewing.

## Who may sign in

The allowlist lives in `data/omni.config.json`:

```json
{
  "auth": {
    "allowedEmails": ["you@example.com"],
    "allowedHd": ""
  }
}
```

- `allowedEmails`: exact Google addresses. On a fresh install it is empty, and the first sign-in from a client that already holds the install token (the Mac app, or a browser paired with the token) puts its address there. Until then, a browser without the token cannot sign in at all.
- `allowedHd`: a Google Workspace domain whose verified accounts may all sign in, matched on the ID token's `hd` claim, which only Workspace accounts carry. Leave it empty unless more than one person should get in. When it is the only entry, Google's account chooser shows only that domain's accounts.

If `omni.config.json` does not parse, Omni runs on defaults and refuses the first sign-in, which would otherwise write the defaults over your file.

## Set it up

You need a Google Cloud project with an OAuth consent screen (External, Testing is fine for yourself; add your address as a test user). Then:

1. **This Mac (browsers on this Mac and the Mac app).** Create an OAuth client of type **Desktop app**. Put its client id in `auth.googleClientId` and its client secret in the Keychain as the global secret `GOOGLE_OAUTH_CLIENT_SECRET` (Settings > Secrets). Google calls a Desktop client's secret not confidential, but Omni keeps it in the Keychain like any other. Without it, Sign in with Google says which secret is missing before it opens Google.
2. **Other devices over Tailscale (optional).** Deploy the broker (below), then create an OAuth client of type **Web application** with the authorized redirect URI `<broker URL>/callback`. Put its client id in `auth.googleWebClientId`, the broker URL (`https://`) in `auth.brokerUrl`, and its secret in the Keychain as `GOOGLE_OAUTH_WEB_CLIENT_SECRET`.

```json
{
  "auth": {
    "googleClientId": "1234-abc.apps.googleusercontent.com",
    "googleWebClientId": "1234-def.apps.googleusercontent.com",
    "brokerUrl": "https://<project-ref>.supabase.co/functions/v1/omni-oauth-broker"
  }
}
```

Both secrets stay on the server: no thread or terminal gets them in its environment.

### Deploy the broker

The broker is the only hosted piece: one Edge Function with no table and no database access, so any Supabase project works, including the one sync uses. Don't run `supabase db push` for it.

```bash
supabase link --project-ref <project-ref>
supabase secrets set BROKER_RETURN_ORIGINS=https://<your-mac>.<tailnet>.ts.net
supabase functions deploy omni-oauth-broker --no-verify-jwt
```

`--no-verify-jwt` is needed because Google's redirect carries no Supabase key. `BROKER_RETURN_ORIGINS` is required: a comma-separated list of the exact origins your Omni is reached on, and the only places the broker sends a browser. The function will not start without it. If you also reach Omni on a name from `OMNI_ALLOWED_HOSTS` or a `100.x` address, add that origin too, or the broker refuses to send you back there.

## Tests and the QA stack

`packages/test-fixtures/fake-google.mjs` stands in for Google's endpoints; `OMNI_GOOGLE_AUTH_URL`, `OMNI_GOOGLE_TOKEN_URL` and `OMNI_GOOGLE_JWKS_URL` point the server at it, and `OMNI_GOOGLE_CLIENT_SECRET` / `OMNI_GOOGLE_WEB_CLIENT_SECRET` replace the Keychain secrets. `QA_GOOGLE=1 scripts/qa-stack.sh up` starts one with the stack, with dummy secrets so it never reads the Keychain.
