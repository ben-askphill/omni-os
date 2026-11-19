/**
 * What the live layer needs from pairing: where the server is and the credential that opens it. The connect flow
 * (milestone 3's pairing branch) supplies the real one. Until then `devSession` or `UNPAIRED` stands in.
 */
export interface OmniSession {
  /** The server address as the user gave it. Null while this device is not paired. */
  readonly serverUrl: string | null;
  /**
   * Which server this is on this phone: the paired record's id. Drafts, staged files and Changes context are kept per
   * server under it (live/thread-key.ts), so a cloned install with the same thread ids never gets another's.
   */
  readonly serverId: string;
  /** The bearer token. Read again for each request, so a refresh takes effect on the next one. */
  token(): Promise<string | null>;
  /** Called after a 401. Resolves true when the credentials changed and the request should run again. */
  refreshAuth(): Promise<boolean>;
}

export const UNPAIRED: OmniSession = {
  serverUrl: null,
  serverId: 'unpaired',
  token: async () => null,
  refreshAuth: async () => false,
};
