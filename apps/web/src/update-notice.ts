import type { UpdateView } from './api.ts';

// The Update notice (GET /api/update): what it says and which button it offers. The component draws it.

export type UpdateAction = 'update' | 'cancel' | 'dismiss';

export interface UpdateNotice {
  text: string;
  /** The newest commits main has and this server does not, one per line. */
  detail: string | null;
  action: UpdateAction | null;
  busy: boolean;
  failed: boolean;
}

export function updateNotice(v: UpdateView | null | undefined): UpdateNotice | null {
  if (!v) return null;
  switch (v.phase) {
    case 'waiting':
      return { text: v.waitingFor === 1 ? 'Waiting for 1 running turn' : `Waiting for ${v.waitingFor} running turns`, detail: null, action: 'cancel', busy: true, failed: false };
    case 'updating':
      return { text: 'Updating to main and building', detail: null, action: null, busy: true, failed: false };
    case 'restarting':
      return { text: 'Restarting', detail: null, action: null, busy: true, failed: false };
    case 'failed':
      return { text: v.error || 'The update failed.', detail: null, action: 'dismiss', busy: false, failed: true };
  }
  if (v.behind <= 0) return null;
  const detail = v.commits.length ? v.commits.map((c) => c.subject).join('\n') + (v.behind > v.commits.length ? `\nand ${v.behind - v.commits.length} more` : '') : null;
  const count = v.behind === 1 ? '1 new commit on main' : `${v.behind} new commits on main`;
  if (!v.canApply) return { text: `${count}. Nothing restarts this server, so update it by hand.`, detail, action: null, busy: false, failed: false };
  return { text: count, detail, action: 'update', busy: false, failed: false };
}

const FROM_KEY = 'omni.update.from';

/** Update was clicked from this commit: remember it, so the page reloads once the new server answers. */
export function markUpdateStarted(store: Pick<Storage, 'setItem'>, current: string | null): void {
  if (current) store.setItem(FROM_KEY, current);
}

/**
 * After an Update this page started: true once the server runs another commit (load the new UI), so the caller
 * reloads. The mark goes first, so the reloaded page never reloads again. A failed or cancelled update drops it.
 */
export function reloadAfterUpdate(store: Pick<Storage, 'getItem' | 'removeItem'>, v: UpdateView): boolean {
  const from = store.getItem(FROM_KEY);
  if (!from) return false;
  if (v.current && v.current !== from) {
    store.removeItem(FROM_KEY);
    return true;
  }
  if (v.phase === 'failed' || (v.phase === 'idle' && v.current === from && v.behind === 0)) store.removeItem(FROM_KEY);
  return false;
}

/** Cancel: the server stays on its commit, so nothing waits to reload. */
export function clearUpdateMark(store: Pick<Storage, 'removeItem'>): void {
  store.removeItem(FROM_KEY);
}
