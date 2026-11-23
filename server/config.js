// Central configuration. Values come from .env (if present) and the process environment.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch (err) { console.warn('[config] Could not read .env:', err.message); }
}

const env = (name, fallback = '') => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};
const bool = (name, fallback) => {
  const v = env(name, '');
  if (v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const int = (name, fallback) => {
  const n = Number.parseInt(env(name, ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: int('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  publicUrl: env('PUBLIC_URL', ''),

  db: {
    client: env('DB_CLIENT', 'sqlite').toLowerCase(),
    sqlitePath: path.resolve(ROOT, env('SQLITE_PATH', './data/tipidlitro.db')),
    mysql: {
      host: env('MYSQL_HOST', '127.0.0.1'),
      port: int('MYSQL_PORT', 3306),
      user: env('MYSQL_USER', 'root'),
      password: env('MYSQL_PASSWORD', ''),
      database: env('MYSQL_DATABASE', 'tipidlitro'),
    },
  },

  keys: {
    gemini: env('GEMINI_API_KEY'),
    eia: env('EIA_API_KEY'),
    fred: env('FRED_API_KEY'),
    gnews: env('GNEWS_API_KEY'),
    newsdata: env('NEWSDATA_API_KEY'),
  },
  geminiModel: env('GEMINI_MODEL', 'gemini-2.5-flash'),

  contactEmail: env('CONTACT_EMAIL'),
  osrmUrl: env('OSRM_URL', 'https://router.project-osrm.org').replace(/\/$/, ''),
  osrmFallbackUrl: env('OSRM_FALLBACK_URL', 'https://routing.openstreetmap.de/routed-car').replace(/\/$/, ''),

  scheduler: bool('ENABLE_SCHEDULER', true),
  doeBackfillWeeks: int('DOE_BACKFILL_WEEKS', 26),
  // Pesos per kWh for electric vehicles (no free official API; roughly Meralco's residential rate).
  electricityRate: Number.parseFloat(env('ELECTRICITY_RATE', '12.50')) || 12.5,
  adminEmail: env('ADMIN_EMAIL').toLowerCase(),
  cookieSecure: bool('COOKIE_SECURE', false),
};

export const USER_AGENT = `TipidLitro/1.0 (INTE 301 system integration project${config.contactEmail ? `; ${config.contactEmail}` : ''})`;
