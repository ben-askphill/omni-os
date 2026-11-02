/**
 * What the live layer needs from pairing: where the server is and the credential that opens it. The connect flow
 * (milestone 3's pairing branch) supplies the real one. Until then `devSession` or `UNPAIRED` stands in.
 */
export interface OmniSession {
  /** The server address as the user gave it. Null while this device is not paired. */
  readonly serverUrl: string | null;
  /** The bearer token. Read again for each request, so a refresh takes effect on the next one. */
  token(): Promise<string | null>;
  /** Called after a 401. Resolves true when the credentials changed and the request should run again. */
  refreshAuth(): Promise<boolean>;
}

export const UNPAIRED: OmniSession = {
  serverUrl: null,
  token: async () => null,
  refreshAuth: async () => false,
};
