import type { OmniApi, Recovered } from '@omni/client-core';

import type { LimitAction } from './limit';

/** What a card's button does: one recovery call, each answered with the thread and its pending list as they are now. */
export type NeedsAction =
  | { kind: 'retry-setup' }
  | { kind: 'limit'; action: LimitAction }
  | { kind: 'resume'; ids?: readonly string[] }
  | { kind: 'discard'; id: string };

export type RecoveryApi = Pick<OmniApi, 'retrySetup' | 'scheduleLimit' | 'cancelLimit' | 'resumeLimit' | 'resumeRequests' | 'discardRequests'>;

export function runNeedsAction(api: RecoveryApi, threadId: string, a: NeedsAction): Promise<Recovered> {
  switch (a.kind) {
    case 'retry-setup':
      return api.retrySetup(threadId);
    case 'limit':
      return a.action === 'schedule' ? api.scheduleLimit(threadId) : a.action === 'cancel' ? api.cancelLimit(threadId) : api.resumeLimit(threadId);
    case 'resume':
      return api.resumeRequests(threadId, a.ids);
    case 'discard':
      return api.discardRequests(threadId, [a.id]);
  }
}
