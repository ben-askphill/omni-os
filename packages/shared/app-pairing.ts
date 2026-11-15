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

/** The things an alert can be about. The payload's `kind` is one of these. */
export type AppPushKind = 'needsInput' | 'finished' | 'failed' | 'crewReport' | 'prAttention';

/** Per-device alert choices. Each defaults to on until the device changes it. */
export type AppPushPreferences = Record<AppPushKind, boolean>;

/** A partial update: only the kinds sent change. */
export type AppPushPreferencesUpdate = Partial<AppPushPreferences>;

/**
 * One alert still in the phone's Notification Center, asked about by POST /api/auth/push-settled: `id` is the
 * notification's identifier, `at` the server time the alert carried (`omni.at`).
 */
export interface AppPushAlertRef {
  id: string;
  kind: AppPushKind;
  threadId: string;
  at: string;
}

/** The ids of the alerts the server says Ben has dealt with, here or on another device, so the phone clears them. */
export interface AppPushSettled {
  settled: string[];
}

export interface ServerCapabilities {
  api: number;
  auth: {
    via: 'token' | 'session';
    method: 'google' | 'pairing' | null;
    sessionId: string | null;
  };
  pairing: { app: boolean; codeTtlSeconds: number };
  push: {
    registration: boolean;
    delivery: boolean;
    /** Why `delivery` is false, naming the missing APNs secrets and never a value. Absent from servers before it was added. */
    problem?: string | null;
  };
  streams: { sse: boolean; closeOnRevoke: boolean };
}

export interface ApiError {
  error: string;
}
