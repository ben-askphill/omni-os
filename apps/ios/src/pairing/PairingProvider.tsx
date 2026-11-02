import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { describePairingError, revokedNotice } from './messages';
import { pairingService } from './runtime';
import type { CheckResult } from './service';
import { activeServer, emptyIndex, type PairedServer, type ServerIndex } from './servers';
import type { ServerStatus } from './status';

interface PairingContextValue {
  ready: boolean;
  servers: PairedServer[];
  activeServer: PairedServer | null;
  statusById: Record<string, ServerStatus>;
  notice: string | null;
  pair(input: { origin: string; code: string; name: string }): Promise<PairedServer>;
  select(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  refreshActive(): Promise<void>;
  clearNotice(): void;
  /** Checks with the server that it still accepts the phone. False when it does not, and it is forgotten by then. */
  confirmSignedIn(id: string): Promise<boolean>;
}

type CheckOutcome = CheckResult['kind'] | 'failed';

const PairingContext = createContext<PairingContextValue | null>(null);

export function usePairing(): PairingContextValue {
  const value = useContext(PairingContext);
  if (!value) throw new Error('usePairing needs a PairingProvider');
  return value;
}

export function PairingProvider({ children }: { children: ReactNode }) {
  const service = pairingService;
  const [index, setIndex] = useState<ServerIndex>(emptyIndex);
  const [ready, setReady] = useState(false);
  const [statusById, setStatusById] = useState<Record<string, ServerStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Handlers that outlive a render (AppState, awaited checks) read the latest index here.
  const indexRef = useRef<ServerIndex>(emptyIndex);
  const loadedRef = useRef(false);
  const checksRef = useRef(new Map<string, Promise<CheckOutcome>>());

  function applyIndex(next: ServerIndex) {
    indexRef.current = next;
    setIndex(next);
    const ids = new Set(next.servers.map((server) => server.id));
    setStatusById((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))),
    );
  }

  function setStatus(id: string, status: ServerStatus) {
    setStatusById((current) => ({ ...current, [id]: status }));
  }

  async function runCheck(id: string): Promise<CheckOutcome> {
    setStatus(id, 'checking');
    try {
      const result = await service.checkServer(id);
      switch (result.kind) {
        case 'ready':
          setStatus(id, 'ready');
          break;
        case 'unreachable':
        case 'incompatible':
          setStatus(id, result.kind);
          break;
        case 'revoked':
          applyIndex(result.index);
          setNotice(revokedNotice(result.name));
          break;
        case 'stale':
          break;
      }
      return result.kind;
    } catch {
      setStatus(id, 'unreachable');
      return 'failed';
    }
  }

  function check(id: string): Promise<CheckOutcome> {
    const running = checksRef.current.get(id);
    if (running) return running;
    const started = runCheck(id).finally(() => checksRef.current.delete(id));
    checksRef.current.set(id, started);
    return started;
  }

  async function load() {
    try {
      applyIndex(await service.loadIndex());
      loadedRef.current = true;
      setNotice(null);
    } catch (error) {
      setNotice(describePairingError(error));
    } finally {
      setReady(true);
    }
  }

  async function refreshActive() {
    if (!loadedRef.current) await load();
    const id = indexRef.current.activeId;
    if (id !== null) await check(id);
  }

  useEffect(() => {
    void refreshActive();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshActive();
    });
    return () => subscription.remove();
  }, []);

  const value: PairingContextValue = {
    ready,
    servers: index.servers,
    activeServer: activeServer(index),
    statusById,
    notice,
    async pair(input) {
      const result = await service.pairServer(input);
      applyIndex(result.index);
      setStatus(result.server.id, 'ready');
      setNotice(null);
      return result.server;
    },
    async select(id) {
      applyIndex(await service.selectServer(id));
      void check(id);
    },
    async remove(id) {
      applyIndex(await service.removeServer(id));
    },
    refreshActive,
    clearNotice: () => setNotice(null),
    async confirmSignedIn(id) {
      return (await check(id)) === 'ready';
    },
  };

  return <PairingContext value={value}>{children}</PairingContext>;
}
