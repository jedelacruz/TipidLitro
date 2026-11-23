// TipidLitro server: REST API + static web app + scheduled sync jobs.
import express from 'express';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { closeDb, initDb } from './db/index.js';
import { sessionMiddleware } from './lib/auth.js';
import { HttpError } from './lib/util.js';
import { api } from './routes/api.js';
import { startScheduler } from './services/jobs.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
});

app.use('/api', express.json({ limit: '300kb' }), sessionMiddleware, api);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

const publicDir = path.join(ROOT, 'public');
app.use('/vendor/leaflet', express.static(path.join(ROOT, 'node_modules/leaflet/dist'), { maxAge: '7d' }));
app.use('/vendor/chart', express.static(path.join(ROOT, 'node_modules/chart.js/dist'), { maxAge: '7d' }));
app.use(express.static(publicDir, { maxAge: 0, etag: true }));
// Single-page app: every non-API path serves the shell.
app.get('/{*path}', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on our side. Please try again.' : err.message, ...(err.extra || {}) });
});

async function main() {
  await initDb();
  const server = app.listen(config.port, config.host, () => {
    console.log(`\n  TipidLitro is running → http://localhost:${config.port}`);
    console.log(`  Database: ${config.db.client === 'mysql' ? `MySQL ${config.db.mysql.host}:${config.db.mysql.port}/${config.db.mysql.database}` : config.db.sqlitePath}`);
    console.log(`  Gemini assistant: ${config.keys.gemini ? 'enabled' : 'off (rule-based fallback)'}\n`);
  });
  startScheduler();
  const stop = async () => { server.close(); await closeDb().catch(() => {}); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error('Failed to start TipidLitro:', err.message);
  if (config.db.client === 'mysql') console.error('Check that MySQL/MariaDB is running (XAMPP Control Panel → Start MySQL) and the MYSQL_* settings in .env.');
  process.exit(1);
});
