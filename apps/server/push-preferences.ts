// Which alerts each app device gets. A row exists once the device changes a choice; with no row every kind is on.
// The row goes when the session ends, in the same commit as its push token (google-auth.ts endSessions).
import { z } from 'zod';
import { db, tx } from './db.ts';
import { sessionIsLive } from './google-auth.ts';
import type { ApnsEnvironment } from './push-apns.ts';
import type { AppPushFeature, AppPushKind, AppPushPreferences, AppPushPreferencesUpdate } from '@omni/shared/app-pairing.ts';

const COLUMN: Record<AppPushKind, 'needs_input' | 'finished' | 'failed' | 'crew_report' | 'pr_attention'> = {
  needsInput: 'needs_input',
  finished: 'finished',
  failed: 'failed',
  crewReport: 'crew_report',
  prAttention: 'pr_attention',
};

/** A PUT body: any of the kinds, strictly. An empty body changes nothing, so it is refused. */
export const PushPreferencesBody = z
  .object({ needsInput: z.boolean(), finished: z.boolean(), failed: z.boolean(), crewReport: z.boolean(), prAttention: z.boolean() })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'send at least one of needsInput, finished, failed, crewReport, prAttention');

export interface PushTarget {
  sessionId: string;
  token: string;
  environment: ApnsEnvironment;
  bundleId: string | null;
  /** The app declared `collapse`: alerts go to it with a per-thread collapse id. */
  collapse: boolean;
}

/** Kinds an app build must declare before it gets them: an older build could neither open nor switch them off. */
const KIND_NEEDS: Partial<Record<AppPushKind, AppPushFeature>> = { prAttention: 'prAttention' };

const featuresOf = (raw: string | null): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

interface PrefRow {
  needs_input: number;
  finished: number;
  failed: number;
  crew_report: number;
  pr_attention: number;
}

const DEFAULTS: AppPushPreferences = { needsInput: true, finished: true, failed: true, crewReport: true, prAttention: true };

const fromRow = (r: PrefRow | undefined): AppPushPreferences =>
  r
    ? { needsInput: r.needs_input === 1, finished: r.finished === 1, failed: r.failed === 1, crewReport: r.crew_report === 1, prAttention: r.pr_attention === 1 }
    : { ...DEFAULTS };

/** The device's choices. Every kind is on until it changes one. */
export function readPushPreferences(sessionId: string): AppPushPreferences {
  return fromRow(db.prepare('SELECT needs_input, finished, failed, crew_report, pr_attention FROM push_preferences WHERE session_id = ?').get(sessionId) as PrefRow | undefined);
}

/** Change the kinds sent, and keep the rest. Null, with nothing written, when the session has ended. */
export function updatePushPreferences(sessionId: string, patch: AppPushPreferencesUpdate): AppPushPreferences | null {
  const at = new Date().toISOString();
  return tx(() => {
    if (!sessionIsLive(sessionId)) return null;
    const next = { ...readPushPreferences(sessionId), ...patch };
    db.prepare(
      `INSERT INTO push_preferences (session_id, needs_input, finished, failed, crew_report, pr_attention, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET needs_input = excluded.needs_input, finished = excluded.finished, failed = excluded.failed,
         crew_report = excluded.crew_report, pr_attention = excluded.pr_attention, updated_at = excluded.updated_at`,
    ).run(sessionId, +next.needsInput, +next.finished, +next.failed, +next.crewReport, +next.prAttention, at);
    return next;
  });
}

/**
 * Where an alert of this kind goes now: each registered device whose session is live, whose choice for the kind is
 * on, and whose app build declared the kind when it needs declaring. Read when the alert is queued; the sender checks
 * liveness again before each attempt.
 */
export function pushTargets(kind: AppPushKind, at = Date.now()): PushTarget[] {
  const rows = db
    .prepare(
      `SELECT t.session_id, t.token, t.environment, t.bundle_id, t.features FROM push_tokens t
       LEFT JOIN push_preferences p ON p.session_id = t.session_id
       WHERE COALESCE(p.${COLUMN[kind]}, 1) = 1`,
    )
    .all() as { session_id: string; token: string; environment: ApnsEnvironment; bundle_id: string | null; features: string | null }[];
  const needs = KIND_NEEDS[kind];
  return rows.flatMap((r) => {
    const features = featuresOf(r.features);
    if ((needs && !features.includes(needs)) || !sessionIsLive(r.session_id, at)) return [];
    return [{ sessionId: r.session_id, token: r.token, environment: r.environment, bundleId: r.bundle_id, collapse: features.includes('collapse') }];
  });
}
