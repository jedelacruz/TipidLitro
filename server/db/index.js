// Database adapter: one small API over two engines.
//   sqlite -> Node's built-in node:sqlite (zero setup, default)
//   mysql  -> MySQL / MariaDB via mysql2 (e.g. XAMPP)
// Every query uses `?` placeholders, so SQL in the services works on both.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { columnMigrations, schemaStatements } from './schema.js';
import { seedVehicles } from './seed.js';

let engine = null;

const normalize = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
};
const normParams = (params) => (params || []).map(normalize);

async function openSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(path.dirname(config.db.sqlitePath), { recursive: true });
  const conn = new DatabaseSync(config.db.sqlitePath);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const stmtCache = new Map();
  const prep = (sql) => {
    let s = stmtCache.get(sql);
    if (!s) { s = conn.prepare(sql); stmtCache.set(sql, s); if (stmtCache.size > 500) stmtCache.clear(); }
    return s;
  };
  const plain = (row) => (row ? { ...row } : row);
  return {
    dialect: 'sqlite',
    async all(sql, params) { return prep(sql).all(...normParams(params)).map(plain); },
    async get(sql, params) { return plain(prep(sql).get(...normParams(params))); },
    async run(sql, params) {
      const r = prep(sql).run(...normParams(params));
      return { insertId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async exec(sql) { conn.exec(sql); },
    async transaction(fn) {
      conn.exec('BEGIN');
      try { const out = await fn(); conn.exec('COMMIT'); return out; } catch (e) { conn.exec('ROLLBACK'); throw e; }
    },
    async close() { conn.close(); },
  };
}

async function openMysql() {
  const mysql = (await import('mysql2/promise')).default;
  const { host, port, user, password, database } = config.db.mysql;
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('MYSQL_DATABASE may only contain letters, digits and _');
  const bootstrap = await mysql.createConnection({ host, port, user, password });
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();
  const pool = mysql.createPool({
    host, port, user, password, database,
    connectionLimit: 10, dateStrings: true, decimalNumbers: true, charset: 'utf8mb4', multipleStatements: false,
  });
  // A transaction must run every query on the same connection; route them through this slot.
  let txConn = null;
  const q = (sql, params) => (txConn || pool).query(sql, normParams(params));
  return {
    dialect: 'mysql',
    async all(sql, params) { const [rows] = await q(sql, params); return rows; },
    async get(sql, params) { const [rows] = await q(sql, params); return rows[0]; },
    async run(sql, params) { const [r] = await q(sql, params); return { insertId: r.insertId, changes: r.affectedRows }; },
    async exec(sql) { await pool.query(sql); },
    async transaction(fn) {
      const conn = await pool.getConnection();
      txConn = conn;
      try { await conn.beginTransaction(); const out = await fn(); await conn.commit(); return out; } catch (e) { await conn.rollback(); throw e; } finally { txConn = null; conn.release(); }
    },
    async close() { await pool.end(); },
  };
}

const quoteId = (name) => (engine.dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);

// Transactions are serialized: both engines share one transaction slot.
let txChain = Promise.resolve();
const serialTx = (fn) => {
  const run = txChain.then(() => engine.transaction(fn));
  txChain = run.catch(() => {});
  return run;
};

export const db = {
  get dialect() { return engine.dialect; },
  all: (sql, params) => engine.all(sql, params),
  get: (sql, params) => engine.get(sql, params),
  run: (sql, params) => engine.run(sql, params),
  exec: (sql) => engine.exec(sql),
  transaction: serialTx,

  /** INSERT or UPDATE on unique-key conflict. `keys` = the unique columns. */
  async upsert(table, row, keys, updateCols) {
    const cols = Object.keys(row);
    const upd = (updateCols || cols.filter((c) => !keys.includes(c)));
    const colSql = cols.map(quoteId).join(', ');
    const ph = cols.map(() => '?').join(', ');
    let sql;
    if (engine.dialect === 'mysql') {
      const set = upd.length ? upd.map((c) => `${quoteId(c)} = VALUES(${quoteId(c)})`).join(', ') : `${quoteId(keys[0])} = ${quoteId(keys[0])}`;
      sql = `INSERT INTO ${quoteId(table)} (${colSql}) VALUES (${ph}) ON DUPLICATE KEY UPDATE ${set}`;
    } else {
      const set = upd.length ? `DO UPDATE SET ${upd.map((c) => `${quoteId(c)} = excluded.${quoteId(c)}`).join(', ')}` : 'DO NOTHING';
      sql = `INSERT INTO ${quoteId(table)} (${colSql}) VALUES (${ph}) ON CONFLICT (${keys.map(quoteId).join(', ')}) ${set}`;
    }
    return engine.run(sql, cols.map((c) => row[c]));
  },

  async insert(table, row) {
    const cols = Object.keys(row);
    const sql = `INSERT INTO ${quoteId(table)} (${cols.map(quoteId).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    return engine.run(sql, cols.map((c) => row[c]));
  },

  async insertIgnore(table, row) {
    const cols = Object.keys(row);
    const verb = engine.dialect === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
    const sql = `${verb} INTO ${quoteId(table)} (${cols.map(quoteId).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    return engine.run(sql, cols.map((c) => row[c]));
  },
};

export async function initDb() {
  if (engine) return db;
  engine = config.db.client === 'mysql' ? await openMysql() : await openSqlite();
  for (const stmt of schemaStatements(engine.dialect)) {
    try { await engine.exec(stmt); } catch (err) {
      // Index already exists (MySQL has no CREATE INDEX IF NOT EXISTS in older versions)
      if (!/Duplicate key name|already exists/i.test(err.message)) throw err;
    }
  }
  for (const [probe, alter] of columnMigrations(engine.dialect)) {
    try { await engine.all(probe); } catch { await engine.exec(alter); }
  }
  await seedVehicles(db);
  return db;
}

export async function closeDb() { if (engine) { await engine.close(); engine = null; } }
