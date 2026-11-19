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
  /** What this build of the app can take. A build from before the field sends none and gets neither. */
  features?: AppPushFeature[];
}

/**
 * Alert behaviour an app build has to understand before the server uses it:
 * - `collapse`: alerts carry `apns-collapse-id`, so every alert of a thread shares one notification identifier and the
 *   app must tell taps apart by more than it;
 * - `prAttention`: the build can show, open and switch off pull request alerts.
 */
export type AppPushFeature = 'collapse' | 'prAttention';

/** What the current iOS app declares on PUT /api/auth/push-token. */
export const APP_PUSH_FEATURES: readonly AppPushFeature[] = ['collapse', 'prAttention'];

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
 * notification's identifier, `at` and `sender` what the alert carried (`omni.at`, `omni.sender`).
 */
export interface AppPushAlertRef {
  id: string;
  kind: AppPushKind;
  threadId: string;
  at: string;
  /** The alert's `omni.sender`: only the server that sent an alert settles it. */
  sender: string;
}

/** The most alerts one POST /api/auth/push-settled may ask about. The app asks in batches of this size. */
export const APP_PUSH_SETTLED_MAX = 100;

/** The ids of the alerts the server says Ben has dealt with, here or on another device, so the phone clears them. */
export interface AppPushSettled {
  settled: string[];
}

export interface ServerCapabilities {
  api: number;
  auth: {
    /** `thread`: a thread's own token (apps/server/thread-tokens.ts), which no client holds. */
    via: 'token' | 'session' | 'thread';
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
