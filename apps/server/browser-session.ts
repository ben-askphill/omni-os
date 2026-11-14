// The cookie a paired browser holds (PRD #667, S11): a revocable device session's token, never the install's token.
// HttpOnly, so page scripts never see it, and SameSite=Strict on /api. Named per port (api-token.ts), since cookies
// ignore ports and a QA server on 127.0.0.1 has sessions of its own.
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { cookieName, sessionCookieName } from './api-token.ts';

const overHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
export const cookieOptions = (c: Context) => ({ path: '/api', httpOnly: true, sameSite: 'Strict' as const, secure: overHttps(c), maxAge: 400 * 24 * 3600 });

/** Hand the browser this session, and drop the raw-token cookie older builds set. */
export function setSessionCookie(c: Context, token: string) {
  setCookie(c, sessionCookieName(), token, cookieOptions(c));
  deleteCookie(c, cookieName(), { path: '/api' });
}
