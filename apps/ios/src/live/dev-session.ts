import type { OmniSession } from './session';

/**
 * DEV ONLY. A server and token from the build's environment, so the simulator can reach a local Omni before pairing
 * exists. Expo inlines EXPO_PUBLIC_* into the JavaScript bundle, so the token sits in the dev bundle. Never set these
 * for a release build, and the `isDev` gate keeps them out of one even when they are set.
 */
export function devSession(env: { url?: string; token?: string }, isDev: boolean): OmniSession | null {
  if (!isDev || !env.url || !env.token) return null;
  const token = env.token;
  return {
    serverUrl: env.url,
    token: async () => token,
    refreshAuth: async () => false,
  };
}
