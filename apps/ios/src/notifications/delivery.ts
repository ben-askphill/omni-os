import type { ServerCapabilities } from '@omni/shared/app-pairing.ts';

/**
 * What a server's section says when that server cannot send alerts: each server signs its own with its APNs key. Null
 * when it can, and when its capabilities could not be read.
 */
export function deliveryNote(push: ServerCapabilities['push'] | null): string | null {
  if (push?.delivery !== false) return null;
  const why = push.problem ? ` (${push.problem})` : '';
  return `This server cannot send alerts yet because it has no working APNs key${why}. Add the key in Omni's Settings on that computer, then restart Omni.`;
}
