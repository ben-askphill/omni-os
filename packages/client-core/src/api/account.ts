import { apiPath, type HttpClient } from '../http.ts';

/** A device signed in to the server: a browser with Google, or an app that paired. */
export interface SignedInDevice {
  id: string;
  name: string;
  kind: 'browser' | 'app';
  createdAt: string;
  lastSeenAt: string;
  /** The device that asked. */
  current: boolean;
}

/** A client that signed in to `/mcp` with OAuth. `via` says how the server matched its token: by audience, by client id, or not yet. */
export interface McpClient {
  id: string;
  name: string | null;
  status: 'approved' | 'pending' | 'removed';
  firstSeen: string;
  lastSeen: string;
  via: 'audience' | 'client' | null;
}

export function accountApi(http: HttpClient) {
  return {
    /** The signed-in devices, most recently used first. Empty until the server has an owner. */
    signedInDevices: async () => (await http.request<{ devices: SignedInDevice[] }>('GET', apiPath`/auth/devices`)).devices,
    revokeDevice: (id: string) => http.request<{ ok: true }>('DELETE', apiPath`/auth/devices/${id}`),
    /**
     * Writes a new install token and ends every device session, the caller's included. Only the install token or a
     * `token` session may ask; anything else gets a 403. A 404 means the server predates rotation.
     */
    rotateInstallToken: () => http.request<{ ok: true }>('POST', apiPath`/auth/rotate-token`, { body: {} }),
    /** The OAuth clients that reached `/mcp`, removed ones included. A 404 means the server predates the list. */
    mcpClients: () => http.request<McpClient[]>('GET', apiPath`/mcp/clients`),
    approveMcpClient: (id: string) => http.request<McpClient>('POST', apiPath`/mcp/clients/${id}/approve`, { body: {} }),
    removeMcpClient: (id: string) => http.request<{ ok: true }>('DELETE', apiPath`/mcp/clients/${id}`),
  };
}
