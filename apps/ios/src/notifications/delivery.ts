import type { ServerCapabilities } from '@omni/shared/app-pairing.ts';

/**
 * What the Notifications screen says under a server that cannot send alerts, or null when it can. The phone can be
 * registered and every switch on while the server has no APNs key, and then nothing arrives: this is the only place
 * that shows it. `problem` names the missing secrets; a server from before it was added sends none.
 */
export function deliveryNote(push: ServerCapabilities['push'] | null): string | null {
  if (!push || push.delivery) return null;
  const why = push.problem ? ` (${push.problem})` : '';
  return `This server cannot send alerts yet: its APNs key is not set up${why}. On the computer, add APNS_AUTH_KEY, APNS_KEY_ID and APNS_TEAM_ID under Settings, then Secrets.`;
}
