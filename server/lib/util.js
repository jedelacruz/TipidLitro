import { createHash } from 'node:crypto';

export const sha1 = (s) => createHash('sha1').update(String(s)).digest('hex');

/** 'YYYY-MM-DD HH:MM:SS' in UTC — the timestamp format stored in both databases. */
export const nowSql = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');
export const addSeconds = (sec, d = new Date()) => nowSql(new Date(d.getTime() + sec * 1000));
export const sqlToDate = (s) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00:00Z' : 'Z')) : null);

// Philippine time is UTC+8 all year (no DST).
const PH_OFFSET_MS = 8 * 3600 * 1000;
export const manilaParts = (d = new Date()) => {
  const m = new Date(d.getTime() + PH_OFFSET_MS);
  return { y: m.getUTCFullYear(), mo: m.getUTCMonth() + 1, d: m.getUTCDate(), h: m.getUTCHours(), min: m.getUTCMinutes(), dow: m.getUTCDay() };
};
export const manilaDate = (d = new Date()) => new Date(d.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
export const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const addDays = (iso, n) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
/** Monday of the ISO week containing `iso` (YYYY-MM-DD). */
export const mondayOf = (iso) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
};

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const monthIndex = (name) => {
  const n = String(name || '').toLowerCase().slice(0, 3);
  const i = MONTHS.findIndex((m) => m.startsWith(n));
  return i >= 0 ? i + 1 : 0;
};

export const round = (n, dp = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const median = (arr) => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
export const mode = (arr) => {
  const counts = new Map();
  for (const v of arr) if (Number.isFinite(v)) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null; let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && v < best)) { best = v; n = c; }
  return best;
};
export const mean = (arr) => { const a = arr.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
export const stdev = (arr) => {
  const a = arr.filter(Number.isFinite); const m = mean(a);
  return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : null;
};

const R = 6371;
const rad = (x) => (x * Math.PI) / 180;
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Initial compass bearing (degrees) from a to b. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Pick up to `max` points spread evenly along a polyline of [lng, lat] pairs. */
export function samplePolyline(coords, max = 100) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineKm({ lat: coords[i - 1][1], lng: coords[i - 1][0] }, { lat: coords[i][1], lng: coords[i][0] }));
  }
  if (coords.length <= max) return coords.map(([lng, lat], i) => ({ lat, lng, km: cum[i] }));
  const total = cum[cum.length - 1];
  const out = []; let j = 0;
  for (let k = 0; k < max; k++) {
    const target = (total * k) / (max - 1);
    while (j < cum.length - 1 && cum[j + 1] < target) j++;
    out.push({ lat: coords[j][1], lng: coords[j][0], km: cum[j] });
  }
  return out;
}

export const isFiniteCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
