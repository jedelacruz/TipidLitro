// Price alerts -> in-app notifications. Evaluated after every DOE sync and forecast run.
import { db } from '../db/index.js';
import { PRODUCTS } from '../integrations/doe.js';
import { nowSql } from '../lib/util.js';
import { getForecast } from './forecast.js';
import { ADJ_PRODUCT, adjustments, priceFor } from './prices.js';

export const ALERT_KINDS = ['below', 'above', 'adjustment', 'rollback'];

export async function notify(userId, title, body = null, link = null) {
  await db.insert('notifications', { user_id: userId, title: title.slice(0, 200), body: body ? body.slice(0, 600) : null, link, created_at: nowSql(), read_at: null });
}

const peso = (n) => `₱${Number(n).toFixed(2)}`;
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const signed = (n) => (n == null ? 'n/a' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}₱${Math.abs(n).toFixed(2)}`);

export function describeAlert(a) {
  const prod = PRODUCTS[a.product] || a.product;
  if (a.kind === 'below') return `${a.region} ${prod} drops to ${peso(a.threshold)}/L or lower`;
  if (a.kind === 'above') return `${a.region} ${prod} rises to ${peso(a.threshold)}/L or higher`;
  if (a.kind === 'adjustment') return 'A new weekly price adjustment is announced';
  return `A rollback of at least ${peso(a.threshold || 0.5)}/L is expected for ${ADJ_PRODUCT[a.product]?.toLowerCase() || 'fuel'}`;
}

/** Check every active alert once; each fires at most once per price week / adjustment / forecast target. */
export async function evaluateAlerts() {
  const alerts = await db.all('SELECT * FROM price_alerts WHERE active = 1');
  if (!alerts.length) return 0;
  const latestAdj = (await adjustments(1))[0] || null;
  let forecast; let sent = 0;
  for (const a of alerts) {
    let key = null; let title = null; let body = null; let link = '#/prices';
    if (a.kind === 'below' || a.kind === 'above') {
      const p = await priceFor({ region: a.region, product: a.product });
      if (!p || p.fallback) continue;
      const hit = a.kind === 'below' ? p.price <= a.threshold : p.price >= a.threshold;
      if (hit) {
        key = p.weekStart;
        title = `${PRODUCTS[a.product] || a.product} is ${peso(p.price)}/L in ${a.region}`;
        body = `Your alert (${a.kind === 'below' ? '≤' : '≥'} ${peso(a.threshold)}) matched the DOE ${a.region} common price for the week of ${day(p.weekStart)}.`;
      }
    } else if (a.kind === 'adjustment' && latestAdj) {
      key = latestAdj.weekStart;
      title = `Price adjustment effective ${day(latestAdj.weekStart)}`;
      body = `Gasoline ${signed(latestAdj.GASOLINE)}, diesel ${signed(latestAdj.DIESEL)}, kerosene ${signed(latestAdj.KEROSENE)} per liter.`;
    } else if (a.kind === 'rollback') {
      try { forecast ||= await getForecast(); } catch { continue; }
      const f = forecast.products.find((x) => x.product === (ADJ_PRODUCT[a.product] || 'GASOLINE'));
      const v = f?.announced ?? f?.estimate;
      if (v != null && v <= -(a.threshold || 0.5)) {
        key = forecast.targetWeekStart;
        title = `${f.announced != null ? 'Rollback announced' : 'Rollback expected'} for ${f.product.toLowerCase()}: ${signed(v)}/L`;
        body = `${f.announced != null ? 'Effective' : 'Estimated for'} ${day(forecast.targetWeekStart)}. ${f.advice?.text || ''}`;
        link = '#/watch';
      }
    }
    if (key && key !== a.last_triggered) {
      await notify(a.user_id, title, body, link);
      await db.run('UPDATE price_alerts SET last_triggered = ? WHERE id = ?', [key, a.id]);
      sent++;
    }
  }
  return sent;
}
