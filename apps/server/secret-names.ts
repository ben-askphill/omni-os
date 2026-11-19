// The names secrets go by that Omni treats specially, and the shapes a name and a scope take. Pure, with no store or
// database behind it, so code that only checks names (harness/custom.ts) imports this, not secrets.ts.
import { SERVER_ONLY_VARS } from './harness/env-guard.ts';
import { WEBHOOK_SECRET_PREFIX } from './github-webhook.ts';

/** Omni's own sync credentials (apps/server/sync/worker.ts). Global, and never handed to an agent's environment. */
export const SYNC_SECRETS = { url: 'OMNI_RELAY_URL', token: 'OMNI_RELAY_TOKEN' } as const;
/** The Supabase relay's, from before the Cloudflare one (ADR 0008). Still kept from threads until a new sign-in removes them. */
export const LEGACY_SYNC_SECRETS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_REFRESH_TOKEN'] as const;
/** Omni Connect's machine key and tunnel token (apps/server/connect/service.ts). Global, and never handed to an agent. */
export const CONNECT_SECRET_NAMES = ['OMNI_CONNECT_KEY', 'OMNI_CONNECT_TUNNEL_TOKEN'] as const;
/** This machine's key for secrets other machines send it (secret-drop.ts). Global, and never handed to an agent. */
export const SEAL_SECRET_NAME = 'OMNI_SEAL_KEY';
/** This machine's key for signing the sync changes it pushes (sync/sign-key.ts). Global, and never handed to an agent. */
export const SIGN_SECRET_NAME = 'OMNI_SIGN_KEY';
/** The APNs signing key push-sender.ts reads. Global, and never handed to an agent. */
export const APNS_KEY_SECRET = 'APNS_AUTH_KEY';
const PRIVATE = new Set<string>([...Object.values(SYNC_SECRETS), ...LEGACY_SYNC_SECRETS, ...CONNECT_SECRET_NAMES, SEAL_SECRET_NAME, SIGN_SECRET_NAME, APNS_KEY_SECRET]);
const SERVER_ONLY = new Set<string>(SERVER_ONLY_VARS);

/** Omni's own credentials: sync, Connect, seal, signing and APNs (global only), the Grok Bot webhook and webhook signing secrets (any scope). */
export function omniCredential(scope: string, name: string): boolean {
  if (SERVER_ONLY.has(name) || name.startsWith(WEBHOOK_SECRET_PREFIX)) return true;
  return scope === 'global' && PRIVATE.has(name);
}

export const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SCOPE_RE = /^(global|channel:[a-z0-9-]+)$/;
