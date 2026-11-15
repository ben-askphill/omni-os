import { APP_PUSH_SETTLED_MAX, type AppPushAlertRef } from '@omni/shared/app-pairing.ts';

import { alertOf, type NotificationLike, type OmniAlert } from './alert';
import type { PushServer } from './registration';

// Clears Omni's alerts from Notification Center once Ben has dealt with them, on this phone or another device. Opening
// a thread here clears its alerts at once. Otherwise the app asks each paired server which alerts are settled (POST
// /api/auth/push-settled, apps/server/push-settled.ts) when it comes to the front and whenever Needs you changes.
// The server sends at most one alert per thread (apns-collapse-id), so this mostly clears one per thread.

/** One of Omni's alerts still in Notification Center, by its notification identifier. */
export interface Delivered {
  id: string;
  alert: OmniAlert;
}

/** Omni's alerts among the notifications iOS still shows. Anything else is left alone. */
export function deliveredAlerts(list: readonly NotificationLike[]): Delivered[] {
  return list.flatMap((n) => {
    const alert = alertOf(n);
    return alert ? [{ id: n.request.identifier, alert }] : [];
  });
}

/** The alerts a thread on screen covers: its own, and a delegated question it asked. */
export function alertsForThread(delivered: readonly Delivered[], threadId: string): string[] {
  return delivered.filter(({ alert }) => alert.threadId === threadId || alert.askerId === threadId).map((d) => d.id);
}

/**
 * What the servers are asked about: alerts that say when and by which server they were sent. An alert from an older
 * server says neither and cannot be asked about: opening its thread clears it.
 */
export function settleQueries(delivered: readonly Delivered[]): AppPushAlertRef[] {
  return delivered.flatMap(({ id, alert }) =>
    alert.at && alert.sender ? [{ id, kind: alert.kind, threadId: alert.threadId, at: alert.at, sender: alert.sender }] : [],
  );
}

/** Splits a list into runs of at most `size`. */
const batches = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export interface ClearerDeps {
  delivered(): Promise<Delivered[]>;
  /**
   * Every paired server. An alert's `sender` is the server's own id, not the phone's name for it, so each is asked and
   * only the sender answers for it.
   */
  servers(): Promise<PushServer[]>;
  /** The ids a server says are settled. A server that does not have the thread never names it. */
  settled(server: PushServer, alerts: AppPushAlertRef[]): Promise<string[]>;
  dismiss(id: string): Promise<void>;
}

export interface AlertClearer {
  /** Asks the servers and clears what they say is settled. A call while one runs runs once more after it. */
  sweep(): Promise<void>;
  /** This thread is on screen: its alerts go now, without asking. */
  opened(threadId: string): Promise<void>;
}

export function createAlertClearer(deps: ClearerDeps): AlertClearer {
  let busy: Promise<void> | null = null;
  let again = false;

  const dismiss = async (ids: Iterable<string>) => {
    for (const id of new Set(ids)) await deps.dismiss(id).catch(() => undefined);
  };

  async function once() {
    const queries = settleQueries(await deps.delivered());
    if (!queries.length) return;
    // The server takes at most APP_PUSH_SETTLED_MAX per request and refuses more, so a full Notification Center asks in batches.
    const servers = await deps.servers();
    const answers = await Promise.all(
      servers.flatMap((server) => batches(queries, APP_PUSH_SETTLED_MAX).map((batch) => deps.settled(server, batch).catch((): string[] => []))),
    );
    await dismiss(answers.flat());
  }

  return {
    sweep() {
      if (busy) {
        again = true;
        return busy;
      }
      busy = (async () => {
        do {
          again = false;
          await once().catch(() => undefined);
        } while (again);
        busy = null;
      })();
      return busy;
    },
    async opened(threadId) {
      const delivered = await deps.delivered().catch((): Delivered[] => []);
      await dismiss(alertsForThread(delivered, threadId));
    },
  };
}
