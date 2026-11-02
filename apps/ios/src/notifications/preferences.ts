import type { AppPushKind, AppPushPreferences } from '@omni/shared/app-pairing.ts';

import { PUSH_KINDS } from './alert';

/** The words the preferences screen shows for each kind of alert. */
export const KIND_COPY: Record<AppPushKind, { title: string; detail: string }> = {
  needsInput: { title: 'Needs your answer', detail: 'An agent asked a question and is waiting.' },
  finished: { title: 'Finished', detail: 'A thread finished its work.' },
  failed: { title: 'Failed', detail: 'A thread failed, or its workspace could not be prepared.' },
  crewReport: { title: 'Crew reports', detail: 'A crew member reported back to the Conductor.' },
};

export { PUSH_KINDS };

interface Pending {
  value: boolean;
  /** Which request this belongs to. A reply for an older request never clears a newer choice. */
  seq: number;
}

export type PrefsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      /** What the server last said. */
      confirmed: AppPushPreferences;
      /** Switches flipped and not yet answered, shown as the person set them. */
      pending: Partial<Record<AppPushKind, Pending>>;
      /** The last save that failed, until the next change. */
      error: string | null;
    };

export type PrefsAction =
  | { type: 'loading' }
  | { type: 'loaded'; values: AppPushPreferences }
  | { type: 'loadFailed'; message: string }
  | { type: 'toggled'; kind: AppPushKind; value: boolean; seq: number }
  | { type: 'saved'; kind: AppPushKind; seq: number; values: AppPushPreferences }
  | { type: 'saveFailed'; kind: AppPushKind; seq: number; message: string };

export const initialPrefs: PrefsState = { status: 'loading' };

function without(pending: PrefsStateReady['pending'], kind: AppPushKind, seq: number): PrefsStateReady['pending'] {
  if (pending[kind]?.seq !== seq) return pending;
  const { [kind]: _settled, ...rest } = pending;
  return rest;
}

type PrefsStateReady = Extract<PrefsState, { status: 'ready' }>;

export function prefsReducer(state: PrefsState, action: PrefsAction): PrefsState {
  switch (action.type) {
    case 'loading':
      return initialPrefs;
    case 'loaded':
      return { status: 'ready', confirmed: action.values, pending: {}, error: null };
    case 'loadFailed':
      return { status: 'error', message: action.message };
  }
  if (state.status !== 'ready') return state;
  switch (action.type) {
    case 'toggled':
      return { ...state, error: null, pending: { ...state.pending, [action.kind]: { value: action.value, seq: action.seq } } };
    case 'saved':
      // The reply is the whole set as the server holds it, but a switch flipped again since stays as flipped.
      return { ...state, confirmed: action.values, pending: without(state.pending, action.kind, action.seq) };
    case 'saveFailed':
      return { ...state, error: action.message, pending: without(state.pending, action.kind, action.seq) };
  }
}

/** What each switch shows: the person's latest choice where one is waiting, the server's answer otherwise. */
export function shownPreferences(state: PrefsStateReady): AppPushPreferences {
  const shown = { ...state.confirmed };
  for (const kind of PUSH_KINDS) {
    const pending = state.pending[kind];
    if (pending) shown[kind] = pending.value;
  }
  return shown;
}
