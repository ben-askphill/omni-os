export interface AppPairingCode {
  code: string;
  expiresAt: string;
}

export interface AppPairingQr {
  version: 1;
  serverUrl: string;
  code: string;
}

export interface AppPairingRedeemRequest {
  code: string;
  name: string;
}

export interface AppPairingRedeemResponse {
  token: string;
  sessionId: string;
}

export interface AppPushTokenRequest {
  token: string;
  platform: 'ios';
  environment: 'sandbox' | 'production';
  bundleId?: string;
}

export interface AppPushTokenStatus {
  registered: boolean;
  platform?: 'ios';
  environment?: 'sandbox' | 'production';
  bundleId?: string;
  updatedAt?: string;
}

/** The four things an alert can be about. The payload's `kind` is one of these. */
export type AppPushKind = 'needsInput' | 'finished' | 'failed' | 'crewReport';

/** Per-device alert choices. Each defaults to on until the device changes it. */
export type AppPushPreferences = Record<AppPushKind, boolean>;

/** A partial update: only the kinds sent change. */
export type AppPushPreferencesUpdate = Partial<AppPushPreferences>;

export interface ServerCapabilities {
  api: number;
  auth: {
    via: 'token' | 'session';
    method: 'google' | 'pairing' | null;
    sessionId: string | null;
  };
  pairing: { app: boolean; codeTtlSeconds: number };
  push: { registration: boolean; delivery: boolean };
  streams: { sse: boolean; closeOnRevoke: boolean };
}

export interface ApiError {
  error: string;
}
