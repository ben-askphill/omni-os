import type { AppPushKind, AppPushPreferences } from '@omni/shared/app-pairing.ts';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { describePushError } from './api';
import { initialPrefs, prefsReducer, shownPreferences } from './preferences';
import type { PushServer } from './registration';
import { useNotifications } from './NotificationsProvider';

export interface PushPreferencesView {
  status: 'loading' | 'error' | 'ready';
  /** The load failure, when `status` is `error`. */
  message: string | null;
  /** What each switch shows. Null until loaded. */
  values: AppPushPreferences | null;
  /** The last save that failed. The switch is already back where the server has it. */
  saveError: string | null;
  toggle(kind: AppPushKind, value: boolean): void;
  retry(): void;
}

/** One server's alert choices: loaded when the screen opens, and each switch saves on its own, sending only that key. */
export function usePushPreferences(server: PushServer): PushPreferencesView {
  const { api } = useNotifications();
  const [state, dispatch] = useReducer(prefsReducer, initialPrefs);
  const seq = useRef(0);
  const { id, origin } = server;

  const load = useCallback(() => {
    let cancelled = false;
    dispatch({ type: 'loading' });
    api.preferences({ id, origin }).then(
      (values) => !cancelled && dispatch({ type: 'loaded', values }),
      (error: unknown) => !cancelled && dispatch({ type: 'loadFailed', message: describePushError(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, id, origin]);

  useEffect(() => load(), [load]);

  return {
    status: state.status,
    message: state.status === 'error' ? state.message : null,
    values: state.status === 'ready' ? shownPreferences(state) : null,
    saveError: state.status === 'ready' ? state.error : null,
    toggle(kind, value) {
      const mine = ++seq.current;
      dispatch({ type: 'toggled', kind, value, seq: mine });
      api.setPreferences({ id, origin }, { [kind]: value }).then(
        (values) => dispatch({ type: 'saved', kind, seq: mine, values }),
        (error: unknown) => dispatch({ type: 'saveFailed', kind, seq: mine, message: describePushError(error) }),
      );
    },
    retry: () => void load(),
  };
}
