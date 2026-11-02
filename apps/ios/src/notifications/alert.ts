import type { AppPushKind } from '@omni/shared/app-pairing.ts';

/** What the server puts under `omni` in every alert: where to go, never what was said. */
export interface OmniAlert {
  kind: AppPushKind;
  threadId: string;
  channelId: string | null;
}

export const PUSH_KINDS: readonly AppPushKind[] = ['needsInput', 'finished', 'failed', 'crewReport'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The `omni` object of an APNs payload, or null for anything that is not one of Omni's alerts. */
export function parseAlert(payload: unknown): OmniAlert | null {
  if (!isRecord(payload) || !isRecord(payload.omni)) return null;
  const { kind, threadId, channelId } = payload.omni;
  if (typeof threadId !== 'string' || threadId === '') return null;
  if (!PUSH_KINDS.includes(kind as AppPushKind)) return null;
  return {
    kind: kind as AppPushKind,
    threadId,
    channelId: typeof channelId === 'string' && channelId !== '' ? channelId : null,
  };
}

/** The slice of an expo-notifications notification that carries the payload. */
export interface NotificationLike {
  request: {
    identifier: string;
    content: { data?: unknown };
    trigger?: unknown;
  };
}

/**
 * iOS gives a remote notification's custom keys as `content.data` and the whole payload as `trigger.payload`. Reading
 * both keeps the parse independent of which one a given SDK version fills.
 */
export function alertOf(notification: NotificationLike): OmniAlert | null {
  const fromData = parseAlert(notification.request.content.data);
  if (fromData) return fromData;
  const trigger = notification.request.trigger;
  return isRecord(trigger) ? parseAlert(trigger.payload) : null;
}
