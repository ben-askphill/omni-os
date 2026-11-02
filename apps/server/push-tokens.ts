// The push token an app registers for its own session. One per session, and it dies with the session: google-auth.ts
// deletes it whenever it ends sessions. push-sender.ts reads the registry through push-preferences.ts (pushTargets),
// which joins it to each device's alert choices and to live sessions.
import { z } from 'zod';
import { db, tx } from './db.ts';

export const PushTokenBody = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{32,400}$/, 'token: 32 to 400 hex characters')
    .transform((t) => t.toLowerCase()),
  platform: z.literal('ios'),
  environment: z.enum(['sandbox', 'production']),
  bundleId: z.string().trim().min(1).max(200).optional(),
});
export type PushTokenInput = z.infer<typeof PushTokenBody>;

export interface PushRegistration {
  platform: string;
  environment: string;
  bundleId: string | null;
  updatedAt: string;
}

const now = () => new Date().toISOString();

/**
 * Set the session's token. A token another session held moves here: a token names one install of the app.
 * False, and nothing written, when the session has been revoked: a row for it would never be deleted.
 */
export function setPushToken(sessionId: string, input: PushTokenInput): boolean {
  const at = now();
  return tx(() => {
    if (!db.prepare('SELECT 1 FROM device_sessions WHERE id = ? AND revoked_at IS NULL').get(sessionId)) return false;
    db.prepare('DELETE FROM push_tokens WHERE token = ? AND platform = ? AND environment = ? AND session_id != ?').run(input.token, input.platform, input.environment, sessionId);
    db.prepare(
      `INSERT INTO push_tokens (session_id, token, platform, environment, bundle_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET token = excluded.token, platform = excluded.platform, environment = excluded.environment, bundle_id = excluded.bundle_id, updated_at = excluded.updated_at`,
    ).run(sessionId, input.token, input.platform, input.environment, input.bundleId ?? null, at, at);
    return true;
  });
}

/** What is registered for the session, without the token. */
export function pushRegistration(sessionId: string): PushRegistration | null {
  const r = db.prepare('SELECT platform, environment, bundle_id, updated_at FROM push_tokens WHERE session_id = ?').get(sessionId) as
    | { platform: string; environment: string; bundle_id: string | null; updated_at: string }
    | undefined;
  return r ? { platform: r.platform, environment: r.environment, bundleId: r.bundle_id, updatedAt: r.updated_at } : null;
}

/** Drop the session's token. False when it had none. */
export const deletePushToken = (sessionId: string) => db.prepare('DELETE FROM push_tokens WHERE session_id = ?').run(sessionId).changes > 0;

/**
 * Drop a token Apple said is dead (410, or BadDeviceToken). Whichever session holds it loses the registration, so a
 * reinstalled app that registers again gets a fresh row.
 */
export const forgetPushToken = (token: string) => db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token).changes;
