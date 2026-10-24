import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SESSION_PREFIX, isSessionCredential } from '../../api-token.ts';
import { db, now, tx } from '../connection.ts';

// Who signed in with Google, from which browser or Mac, and the session each one holds (apps/server/sign-in.ts).
// A session's credential is `omni_s1.<id>.<secret>`: the id finds the row, and only a hash of the secret is stored,
// so a copy of omni.db signs nobody in. Install-local: nothing here goes to the sync relay.

export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;
/** How stale last_seen and the expiry may get before a request writes them again: one write per device per 5 minutes. */
const TOUCH_MS = 5 * 60_000;

export type DeviceKind = 'browser' | 'mac';

export type AuthUser = { id: string; google_sub: string; email: string; name: string | null; hd: string | null; created_at: string };

export type AuthDevice = {
  id: string;
  user_id: string;
  name: string;
  kind: DeviceKind;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

/** A live session, as requestGuard sees it. `renewed` is true when this check moved its expiry, so the cookie moves too. */
export type SessionAccess = {
  sessionId: string;
  expiresAt: string;
  renewed: boolean;
  user: { id: string; email: string; name: string | null; hd: string | null };
  device: { id: string; name: string; kind: DeviceKind };
};

/** A device in Settings > Devices: signed in, not revoked, its session not expired. */
export type DeviceListing = {
  id: string;
  name: string;
  kind: DeviceKind;
  email: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const iso = (ms: number) => new Date(ms).toISOString();

function parse(credential: string): { id: string; secret: string } | null {
  if (!isSessionCredential(credential)) return null;
  const [id, secret, extra] = credential.slice(SESSION_PREFIX.length).split('.');
  if (!id || !secret || extra !== undefined || id.length > 64 || secret.length > 128) return null;
  return { id, secret };
}

export const auth = {
  /** The Omni user for a Google account (its `sub`), made on first sign-in; email, name and domain follow Google's latest. */
  upsertUser(claims: { sub: string; email: string; name?: string | null; hd?: string | null }): AuthUser {
    return db
      .prepare(
        `INSERT INTO auth_users (id, google_sub, email, name, hd, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, hd = excluded.hd RETURNING *`,
      )
      .get(randomUUID(), claims.sub, claims.email.toLowerCase(), claims.name ?? null, claims.hd ?? null, now()) as AuthUser;
  },

  /** A new device for `userId` with a fresh session. The credential is returned once and never stored. */
  signIn(input: { userId: string; name: string; kind: DeviceKind; userAgent?: string | null }, nowMs = Date.now()) {
    return tx(() => {
      const device: AuthDevice = {
        id: randomUUID(),
        user_id: input.userId,
        name: input.name.trim().slice(0, 80) || 'Unnamed device',
        kind: input.kind,
        user_agent: input.userAgent?.slice(0, 400) ?? null,
        created_at: iso(nowMs),
        last_seen_at: iso(nowMs),
        revoked_at: null,
      };
      db.prepare('INSERT INTO auth_devices (id, user_id, name, kind, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        device.id,
        device.user_id,
        device.name,
        device.kind,
        device.user_agent,
        device.created_at,
        device.last_seen_at,
      );
      const id = randomBytes(16).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      const expiresAt = iso(nowMs + SESSION_DAYS * DAY_MS);
      db.prepare('INSERT INTO auth_sessions (id, device_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        device.id,
        sha256(secret).toString('hex'),
        expiresAt,
        iso(nowMs),
      );
      return { device, credential: `${SESSION_PREFIX}${id}.${secret}`, expiresAt };
    });
  },

  /**
   * The session `credential` names, when it is live: the secret matches, neither it nor its device is revoked, it has
   * not expired, and `admit` takes its user. Sliding: a use more than 5 minutes after the last one moves the expiry to
   * 30 days out and marks the device seen.
   */
  check(credential: string | undefined | null, nowMs = Date.now(), admit: (user: { email: string; hd: string | null }) => boolean = () => true): SessionAccess | null {
    const parts = credential ? parse(credential) : null;
    if (!parts) return null;
    const row = db
      .prepare(
        `SELECT s.id, s.token_hash, s.expires_at, s.revoked_at AS s_revoked, d.id AS device_id, d.name AS device_name, d.kind,
                d.last_seen_at, d.revoked_at AS d_revoked, u.id AS user_id, u.email, u.name, u.hd
         FROM auth_sessions s JOIN auth_devices d ON d.id = s.device_id JOIN auth_users u ON u.id = d.user_id WHERE s.id = ?`,
      )
      .get(parts.id) as
      | {
          id: string;
          token_hash: string;
          expires_at: string;
          s_revoked: string | null;
          device_id: string;
          device_name: string;
          kind: DeviceKind;
          last_seen_at: string;
          d_revoked: string | null;
          user_id: string;
          email: string;
          name: string | null;
          hd: string | null;
        }
      | undefined;
    if (!row) return null;
    if (!timingSafeEqual(sha256(parts.secret), Buffer.from(row.token_hash, 'hex'))) return null;
    if (row.s_revoked || row.d_revoked || Date.parse(row.expires_at) <= nowMs) return null;
    if (!admit({ email: row.email, hd: row.hd })) return null;
    let expiresAt = row.expires_at;
    const renewed = nowMs - Date.parse(row.last_seen_at) >= TOUCH_MS;
    if (renewed) {
      expiresAt = iso(nowMs + SESSION_DAYS * DAY_MS);
      tx(() => {
        db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE id = ?').run(expiresAt, row.id);
        db.prepare('UPDATE auth_devices SET last_seen_at = ? WHERE id = ?').run(iso(nowMs), row.device_id);
      });
    }
    return {
      sessionId: row.id,
      expiresAt,
      renewed,
      user: { id: row.user_id, email: row.email, name: row.name, hd: row.hd },
      device: { id: row.device_id, name: row.device_name, kind: row.kind },
    };
  },

  /** Signs the device out: it and its sessions stop working at once. False when there is no such live device. */
  revokeDevice(id: string, nowMs = Date.now()): boolean {
    return tx(() => {
      const res = db.prepare('UPDATE auth_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(iso(nowMs), id);
      db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(iso(nowMs), id);
      return Number(res.changes) > 0;
    });
  },

  /** Devices that can still get in, most recently seen first. */
  devices(nowMs = Date.now()): DeviceListing[] {
    return db
      .prepare(
        `SELECT d.id, d.name, d.kind, u.email, d.created_at, d.last_seen_at, s.expires_at
         FROM auth_devices d JOIN auth_users u ON u.id = d.user_id JOIN auth_sessions s ON s.device_id = d.id
         WHERE d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ?
         ORDER BY d.last_seen_at DESC`,
      )
      .all(iso(nowMs)) as DeviceListing[];
  },

  /** Drops devices revoked or expired more than 30 days ago, with their sessions. Users stay. */
  prune(nowMs = Date.now()) {
    const cutoff = iso(nowMs - SESSION_DAYS * DAY_MS);
    tx(() => {
      const dead = `SELECT d.id FROM auth_devices d WHERE d.revoked_at < ?1 OR (d.revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > ?1))`;
      db.prepare(`DELETE FROM auth_sessions WHERE device_id IN (${dead})`).run(cutoff);
      db.prepare(`DELETE FROM auth_devices WHERE id IN (${dead})`).run(cutoff);
    });
  },
};
