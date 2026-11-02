// Which alerts each app device gets. A row exists once the device changes a choice; with no row every kind is on.
// The row goes when the session ends, in the same commit as its push token (google-auth.ts endSessions).
import { z } from 'zod';
import { db, tx } from './db.ts';
import { sessionIsLive } from './google-auth.ts';
import type { ApnsEnvironment } from './push-apns.ts';
import type { AppPushKind, AppPushPreferences, AppPushPreferencesUpdate } from '@omni/shared/app-pairing.ts';

const COLUMN: Record<AppPushKind, 'needs_input' | 'finished' | 'failed' | 'crew_report'> = {
  needsInput: 'needs_input',
  finished: 'finished',
  failed: 'failed',
  crewReport: 'crew_report',
};

/** A PUT body: any of the four kinds, strictly. An empty body changes nothing, so it is refused. */
export const PushPreferencesBody = z
  .object({ needsInput: z.boolean(), finished: z.boolean(), failed: z.boolean(), crewReport: z.boolean() })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'send at least one of needsInput, finished, failed, crewReport');

export interface PushTarget {
  sessionId: string;
  token: string;
  environment: ApnsEnvironment;
  bundleId: string | null;
}

interface PrefRow {
  needs_input: number;
  finished: number;
  failed: number;
  crew_report: number;
}

const DEFAULTS: AppPushPreferences = { needsInput: true, finished: true, failed: true, crewReport: true };

const fromRow = (r: PrefRow | undefined): AppPushPreferences =>
  r ? { needsInput: r.needs_input === 1, finished: r.finished === 1, failed: r.failed === 1, crewReport: r.crew_report === 1 } : { ...DEFAULTS };

/** The device's choices. Every kind is on until it changes one. */
export function readPushPreferences(sessionId: string): AppPushPreferences {
  return fromRow(db.prepare('SELECT needs_input, finished, failed, crew_report FROM push_preferences WHERE session_id = ?').get(sessionId) as PrefRow | undefined);
}

/** Change the kinds sent, and keep the rest. Null, with nothing written, when the session has ended. */
export function updatePushPreferences(sessionId: string, patch: AppPushPreferencesUpdate): AppPushPreferences | null {
  const at = new Date().toISOString();
  return tx(() => {
    if (!sessionIsLive(sessionId)) return null;
    const next = { ...readPushPreferences(sessionId), ...patch };
    db.prepare(
      `INSERT INTO push_preferences (session_id, needs_input, finished, failed, crew_report, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET needs_input = excluded.needs_input, finished = excluded.finished, failed = excluded.failed, crew_report = excluded.crew_report, updated_at = excluded.updated_at`,
    ).run(sessionId, +next.needsInput, +next.finished, +next.failed, +next.crewReport, at);
    return next;
  });
}

/**
 * Where an alert of this kind goes now: each registered device whose session is live and whose choice for the kind is
 * on. Read when the alert is queued; the sender checks liveness again before each attempt.
 */
export function pushTargets(kind: AppPushKind, at = Date.now()): PushTarget[] {
  const rows = db
    .prepare(
      `SELECT t.session_id, t.token, t.environment, t.bundle_id FROM push_tokens t
       LEFT JOIN push_preferences p ON p.session_id = t.session_id
       WHERE COALESCE(p.${COLUMN[kind]}, 1) = 1`,
    )
    .all() as { session_id: string; token: string; environment: ApnsEnvironment; bundle_id: string | null }[];
  return rows
    .filter((r) => sessionIsLive(r.session_id, at))
    .map((r) => ({ sessionId: r.session_id, token: r.token, environment: r.environment, bundleId: r.bundle_id }));
}
