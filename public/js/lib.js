// Shared front-end helpers: DOM builder, API client, formatting, toasts, modals, icons, state.

/** h('div', {class:'x', onClick}, ...children) — children strings become text nodes (XSS-safe). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v; // only for trusted static markup (icons)
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`/api${path}`, {
    method, signal, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const peso0 = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
export const fmt = {
  peso: (n, dp = 2) => (n == null || Number.isNaN(+n) ? '—' : dp === 0 ? peso0.format(n) : pesoFmt.format(n)),
  num: (n, dp = 1) => (n == null || Number.isNaN(+n) ? '—' : Number(n).toLocaleString('en-PH', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
  int: (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-PH')),
  signedPeso: (n) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}₱${Math.abs(n).toFixed(2)}`),
  dur: (min) => {
    if (min == null) return '—';
    const m = Math.round(min);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  },
  date: (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' }) : '—'),
  week: (start, end) => {
    if (!start) return '—';
    const s = new Date(`${start}T00:00:00Z`); const e = end ? new Date(`${end}T00:00:00Z`) : null;
    const mo = (d) => d.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
    if (!e) return fmt.date(start);
    return s.getUTCMonth() === e.getUTCMonth()
      ? `${mo(s)} ${s.getUTCDate()}–${e.getUTCDate()}, ${e.getUTCFullYear()}`
      : `${mo(s)} ${s.getUTCDate()} – ${mo(e)} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
  },
  ago: (ts) => {
    if (!ts) return '—';
    const t = new Date(String(ts).includes('T') ? ts : `${String(ts).replace(' ', 'T')}Z`);
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return t.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  },
};

export const PRODUCT_LABELS = {
  RON91: 'RON 91 (Regular)', RON95: 'RON 95 (Premium)', RON97_100: 'RON 97/100', RON97: 'RON 97', RON100: 'RON 100',
  DIESEL: 'Diesel', DIESEL_PLUS: 'Diesel Plus', KEROSENE: 'Kerosene', ELECTRICITY: 'Electricity',
};
export const SHORT_PRODUCT = { RON91: 'RON91', RON95: 'RON95', RON97_100: 'RON97/100', RON97: 'RON97', RON100: 'RON100', DIESEL: 'Diesel', DIESEL_PLUS: 'Diesel+', KEROSENE: 'Kerosene', ELECTRICITY: 'kWh' };
export const REGIONS = ['NCR', 'North Luzon', 'South Luzon', 'Visayas', 'Mindanao'];
export const BRAND_COLORS = {
  Petron: '#1d4ed8', Shell: '#e5a000', Caltex: '#d32f2f', Phoenix: '#f97316', Total: '#c2185b', 'Flying V': '#7c3aed', Unioil: '#0e7490',
  Seaoil: '#0284c7', PTT: '#2563eb', Cleanfuel: '#16a34a', Jetti: '#ea580c', 'Petro Gazz': '#be123c', Independent: '#64748b',
};
export const brandColor = (b) => BRAND_COLORS[b] || '#64748b';

export function toast(msg, type = 'info', ms = 3200) {
  const el = h('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const store = {
  get(k, def = null) { try { const v = localStorage.getItem(`tl.${k}`); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(`tl.${k}`, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

/** Minimal app-wide state + event bus. */
export const state = { user: null, presets: [], location: null, status: null };
const listeners = new Map();
export const on = (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); };
export const emit = (ev, data) => (listeners.get(ev) || []).forEach((fn) => fn(data));

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    const back = h('div', { class: 'modal-back', onClick: (e) => { if (e.target === back) close(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', null, title), body,
        h('div', { class: 'actions' }, actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''}`, type: 'button', onClick: async () => { const v = a.onClick ? await a.onClick() : a.value; if (v !== false) close(v ?? a.value); } }, a.label)))));
    document.body.append(back);
    document.addEventListener('keydown', esc);
    setTimeout(() => back.querySelector('input,select,textarea,button')?.focus(), 30);
  });
}

export const loading = (text = 'Loading…') => h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text);
export const empty = (ico, title, text, action) => h('div', { class: 'empty' }, h('div', { class: 'ico' }, ico), h('h3', null, title), text ? h('p', null, text) : null, action || null);
export const alertBox = (level, text) => h('div', { class: `alert ${level}` }, icon(level === 'danger' || level === 'warn' ? 'alert' : 'info'), h('div', null, text));

const ICONS = {
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  fuel: '<path d="M3 22V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17"/><path d="M2 22h14"/><path d="M15 9h2a2 2 0 0 1 2 2v6a2 2 0 0 0 4 0V8l-3-3"/><path d="M6 8h6"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/><path d="M5 12h14"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  swap: '<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/>',
  leaf: '<path d="M5 21c0-9 6-15 16-16-1 10-7 16-16 16z"/><path d="M5 21 14 12"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-4v4M16 13h2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
};
export function icon(name, cls = '') {
  const s = h('span', { class: 'ico-wrap', 'aria-hidden': 'true' });
  s.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return s;
}

/** Safe mini-markdown for assistant replies: escapes HTML, then **bold**, _italic_ and bullet lines. */
export function renderMarkdown(text) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
  const lines = esc.split(/\r?\n/);
  let html = ''; let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[•\-*]|\d+\.)\s+(.*)$/);
    if (bullet) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(bullet[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  const div = h('div', { class: 'md' });
  div.innerHTML = html;
  return div;
}

/** Hash routing helpers: #/plan?o=... */
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { route: path || 'plan', params: Object.fromEntries(new URLSearchParams(query)) };
}
export function setQuery(params) {
  const { route } = parseHash();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  history.replaceState(null, '', `#/${route}${qs ? `?${qs}` : ''}`);
}

export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation is not supported by this browser.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { state.location = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(state.location); },
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied.' : 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

/** Chart.js colors from CSS variables, so charts follow the theme. */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { text: v('--muted'), grid: v('--border'), brand: v('--brand'), red: v('--red'), amber: v('--amber'), blue: v('--blue'), faint: v('--faint'), surface: v('--surface') };
}
export const SERIES_COLORS = ['#ea580c', '#0ea5e9', '#7c3aed', '#16a34a', '#e11d48', '#64748b', '#ca8a04', '#0f766e'];
/** Current brand color (orange; lighter in dark mode) for maps and charts. */
export const brandHex = () => themeColors().brand || '#ea580c';

export function makeChart(canvas, config) {
  const c = themeColors();
  const Chart = window.Chart;
  Chart.defaults.color = c.text;
  Chart.defaults.borderColor = c.grid;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const chart = new Chart(canvas, {
    ...config,
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } }, ...(config.options?.plugins || {}) },
      ...config.options,
    },
  });
  return chart;
}

/** Wait for the deferred vendor scripts (Leaflet, Chart.js). */
export function vendorsReady() {
  return new Promise((resolve) => {
    const ok = () => window.L && window.Chart;
    if (ok()) return resolve();
    const t = setInterval(() => { if (ok()) { clearInterval(t); resolve(); } }, 30);
  });
}

/** Toggleable dropdown: returns a wrapper with the trigger button; build() fills the menu on open. */
export function dropdown(trigger, build, { align = 'left' } = {}) {
  const wrap = h('div', { class: 'menu-wrap' }, trigger);
  let menu = null;
  const close = () => { menu?.remove(); menu = null; document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) { close(); return; }
    menu = h('div', { class: `menu ${align === 'right' ? 'right' : ''}`, role: 'menu' });
    build(menu, close);
    wrap.append(menu);
    setTimeout(() => document.addEventListener('click', outside, true));
  });
  return wrap;
}

/** Deep links to navigation apps. Waze navigates from the phone's current location. */
export function navApps(points, { twoWheeler = false } = {}) {
  const o = points[0]; const d = points[points.length - 1];
  const ll = (p) => `${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`;
  const stops = points.length > 2;
  return [
    { key: 'google', name: 'Google Maps', color: '#1a73e8', short: 'G', url: gmapsUrl(points, twoWheeler), note: twoWheeler ? 'Two-wheeler mode, with stops' : stops ? 'Includes your stops' : 'Driving directions' },
    { key: 'waze', name: 'Waze', color: '#33ccff', short: 'W', url: `https://waze.com/ul?ll=${ll(d)}&navigate=yes`, note: 'From your current location to B' },
    { key: 'apple', name: 'Apple Maps', color: '#111827', short: '', url: `https://maps.apple.com/?saddr=${ll(o)}&daddr=${ll(d)}&dirflg=d`, note: stops ? 'A to B (stops not supported)' : 'Driving directions' },
    { key: 'osm', name: 'OpenStreetMap', color: '#7ebc6f', short: 'O', url: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${ll(o)};${ll(d)}`)}`, note: 'Open data, works in any browser' },
  ];
}

/** "Open in…" button: remembers the app you pick last. */
export function openInMenu(points, { twoWheeler = false, gpx = null, label = 'Open in…' } = {}) {
  const apps = navApps(points, { twoWheeler });
  const pref = apps.find((a) => a.key === store.get('navApp', 'google')) || apps[0];
  const primary = h('a', { class: 'btn small', href: pref.url, target: '_blank', rel: 'noopener', onClick: () => store.set('navApp', pref.key) }, icon('external'), pref.name);
  const more = dropdown(h('button', { class: 'btn small', type: 'button', 'aria-haspopup': 'menu' }, label), (menu, close) => {
    for (const a of apps) {
      menu.append(h('a', { href: a.url, target: '_blank', rel: 'noopener', onClick: () => { store.set('navApp', a.key); close(); } },
        h('span', { class: 'app-logo', style: { background: a.color } }, a.short), h('span', null, a.name, h('small', null, a.note))));
    }
    menu.append(h('hr'));
    menu.append(h('button', { type: 'button', onClick: async () => {
      const text = points.map((p, i) => `${i === 0 ? 'A' : i === points.length - 1 ? 'B' : i}: ${(+p.lat).toFixed(6)}, ${(+p.lng).toFixed(6)}${p.label ? ` (${p.label})` : ''}`).join('\n');
      try { await navigator.clipboard.writeText(text); toast('Coordinates copied'); } catch { toast('Could not copy', 'error'); }
      close();
    } }, h('span', { class: 'app-logo', style: { background: '#64748b' } }, '⌖'), h('span', null, 'Copy coordinates', h('small', null, 'Paste into any app or chat'))));
    if (gpx) {
      menu.append(h('button', { type: 'button', onClick: () => { gpx(); close(); } },
        h('span', { class: 'app-logo', style: { background: '#0f766e' } }, 'GPX'), h('span', null, 'Download GPX', h('small', null, 'OsmAnd, Organic Maps, Garmin, Strava…'))));
    }
  }, { align: 'left' });
  return h('div', { class: 'row', style: { gap: '6px' } }, primary, more);
}

/** Save a route as a GPX file (track + named waypoints). */
export function downloadGpx(name, points, geometry) {
  const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const wpts = points.map((p, i) => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${x(i === 0 ? `A ${p.label || ''}` : i === points.length - 1 ? `B ${p.label || ''}` : `Stop ${i}`)}</name></wpt>`).join('\n');
  const trk = geometry.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TipidLitro" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${x(name)}</name></metadata>\n${wpts}\n  <trk><name>${x(name)}</name><trkseg>\n${trk}\n    </trkseg></trk>\n</gpx>\n`;
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  const a = h('a', { href: url, download: `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'route'}.gpx` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function gmapsUrl(points, twoWheeler) {
  const fmtP = (p) => `${p.lat},${p.lng}`;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', fmtP(points[0]));
  u.searchParams.set('destination', fmtP(points[points.length - 1]));
  if (points.length > 2) u.searchParams.set('waypoints', points.slice(1, -1).map(fmtP).join('|'));
  u.searchParams.set('travelmode', twoWheeler ? 'two-wheeler' : 'driving');
  return u.toString();
}
