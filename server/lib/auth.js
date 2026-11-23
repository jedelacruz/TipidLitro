// Accounts and sessions: scrypt password hashes, random session tokens in an HttpOnly cookie.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError, addSeconds, nowSql } from './util.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'tl_session';
const SESSION_TTL = 30 * 24 * 3600;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

export async function createSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  await db.insert('sessions', { token, user_id: userId, created_at: nowSql(), expires_at: addSeconds(SESSION_TTL) });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: SESSION_TTL * 1000, path: '/' });
  return token;
}

/** The mobile app identifies itself so it can receive its session token (stored in the phone's secure storage). */
export const isMobileClient = (req) => req.headers['x-client'] === 'tipidlitro-mobile';

/** Session token from the cookie (web) or an "Authorization: Bearer" header (mobile app). */
function readToken(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+([a-f0-9]{64})$/i);
  return m ? m[1].toLowerCase() : readCookie(req, COOKIE);
}

export async function destroySession(req, res) {
  const token = readToken(req);
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', [token]);
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Attaches req.user (or null) on every request. */
export async function sessionMiddleware(req, _res, next) {
  req.user = null;
  const token = readToken(req);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    try {
      const row = await db.get(
        `SELECT u.id, u.email, u.name, u.role, u.monthly_budget, u.home_region FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`, [token, nowSql()],
      );
      if (row) req.user = row;
    } catch { /* treat as signed out */ }
  }
  next();
}

export const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in first.')));
export const requireAdmin = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(new HttpError(403, 'Admins only.')));

/** Tiny fixed-window rate limiter keyed by IP (+ route). */
export function rateLimit({ windowSec, max, name }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = `${req.ip}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowSec * 1000 }; hits.set(key, h); }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    if (h.n > max) return next(new HttpError(429, `Too many ${name} requests. Try again in a minute.`));
    next();
  };
}
