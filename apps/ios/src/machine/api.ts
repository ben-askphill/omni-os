import type { LiveHub } from '../live/hub';
import type { MachineApi } from './command';
import type { FactsApi } from './facts';

/** Each call goes through the hub, so a 401 refreshes the session (and forgets a revoked server) and is tried once more. */
export function hubMachineApi(hub: Pick<LiveHub, 'request'>): MachineApi & FactsApi {
  return {
    syncStatus: () => hub.request((api) => api.syncStatus()),
    devices: () => hub.request((api) => api.devices()),
    status: () => hub.request((api) => api.status()),
    handOff: (id, to) => hub.request((api) => api.handOff(id, to)),
    takeOver: (id) => hub.request((api) => api.takeOver(id)),
    cancelHandoff: (id) => hub.request((api) => api.cancelHandoff(id)),
  };
}
