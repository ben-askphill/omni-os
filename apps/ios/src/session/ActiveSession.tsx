import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { devSession } from '../live/dev-session';
import { LiveProvider } from '../live/react';
import { UNPAIRED, type OmniSession } from '../live/session';
import { usePairing } from '../pairing/PairingProvider';
import { pairingVault } from '../pairing/runtime';
import { pairedSession } from './paired-session';

const SessionContext = createContext<boolean>(false);

/** True while a server is paired, or a dev build runs on a dev session. False sends the app to Connect. */
export function useHasSession(): boolean {
  return useContext(SessionContext);
}

/**
 * The server the live layer talks to is the active paired server. A dev build with EXPO_PUBLIC_OMNI_DEV_URL and
 * EXPO_PUBLIC_OMNI_DEV_TOKEN set uses them only while nothing is paired; `__DEV__` keeps them out of a release build.
 */
export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const pairing = usePairing();
  // `confirmSignedIn` reads refs and calls state setters only, so the first render's copy stays right for good.
  const [confirmSignedIn] = useState(() => pairing.confirmSignedIn);

  const server = pairing.activeServer;
  const serverId = server?.id;
  const origin = server?.origin;
  const sessionId = server?.sessionId;

  // A new server, origin or pairing makes a new session, and with it a new hub. Other renders keep the same one.
  const session = useMemo<OmniSession>(() => {
    if (serverId !== undefined && origin !== undefined) {
      return pairedSession(
        { id: serverId, origin },
        {
          getToken: (id) => pairingVault.getToken(id),
          confirmSignedIn,
        },
      );
    }
    return (
      devSession({ url: process.env.EXPO_PUBLIC_OMNI_DEV_URL, token: process.env.EXPO_PUBLIC_OMNI_DEV_TOKEN }, __DEV__) ??
      UNPAIRED
    );
    // sessionId is only a key: pairing the same server again must start a clean hub.
  }, [serverId, origin, sessionId, confirmSignedIn]);

  return (
    <SessionContext value={session !== UNPAIRED}>
      <LiveProvider session={session}>{children}</LiveProvider>
    </SessionContext>
  );
}
