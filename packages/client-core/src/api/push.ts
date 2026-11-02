import type {
  AppPushPreferences,
  AppPushPreferencesUpdate,
  AppPushTokenRequest,
  AppPushTokenStatus,
} from '@omni/shared/app-pairing.ts';
import { apiPath, type HttpClient } from '../http.ts';

/** The calls a paired native app makes about its push registration. Every one needs an app session, not the install token. */
export function pushApi(http: HttpClient) {
  return {
    /** Registers the device token for this session. Registering again replaces it. */
    registerPushToken: (body: AppPushTokenRequest) => http.request<{ ok: true }>('PUT', apiPath`/auth/push-token`, { body }),
    /** Whether a token is registered and its metadata. The token is never sent back. */
    pushTokenStatus: () => http.request<AppPushTokenStatus>('GET', apiPath`/auth/push-token`),
    /** Idempotent: deleting what is not there succeeds. */
    deletePushToken: () => http.request<{ ok: true }>('DELETE', apiPath`/auth/push-token`),
    pushPreferences: () => http.request<AppPushPreferences>('GET', apiPath`/auth/push-preferences`),
    /** Sends only the kinds in `update` and returns the full set. */
    setPushPreferences: (update: AppPushPreferencesUpdate) =>
      http.request<AppPushPreferences>('PUT', apiPath`/auth/push-preferences`, { body: update }),
  };
}
