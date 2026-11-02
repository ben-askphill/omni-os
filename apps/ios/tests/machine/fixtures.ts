import { OmniHttpError, type SyncStatus } from '@omni/client-core';
import type { Device, HandoffView, Takeover } from '@omni/shared/handoff.ts';

export function refusal(status: number, message: string, body: unknown = { error: message }): OmniHttpError {
  return new OmniHttpError({ kind: 'http', status, message, body, retryAfter: null });
}

export const unreachable = () => new OmniHttpError({ kind: 'unreachable', detail: 'fetch failed' });

export function sync(over: Partial<SyncStatus> = {}): SyncStatus {
  return { configured: true, enabled: true, signedOut: false, running: false, ...over } as unknown as SyncStatus;
}

export function device(over: Partial<Device> = {}): Device {
  return { id: 'm2', name: 'Studio', reachability: 'online', dnsName: 'studio.tail.ts.net', lastSeen: null, ...over };
}

export function handoff(over: Partial<HandoffView> = {}): HandoffView {
  return {
    id: 'h1',
    from: { id: 'm1', name: 'Laptop' },
    to: { id: 'm2', name: 'Studio' },
    outgoing: true,
    at: '2026-11-02T10:00:00Z',
    state: { phase: 'offered', stale: false },
    leftBehind: null,
    idle: false,
    requested: false,
    ...over,
  };
}

export function takeover(over: Partial<Takeover> = {}): Takeover {
  return { from: { id: 'm2', name: 'Studio' }, to: { id: 'm1', name: 'Laptop' }, running: false, refused: null, ...over };
}
