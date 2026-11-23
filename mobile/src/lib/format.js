// Formatting helpers (same output as the web app's fmt). Implemented by hand so results are
// identical on Android and iOS regardless of the device's Intl support.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fixed = (n, dp) => {
  const neg = n < 0; const [i, d] = Math.abs(n).toFixed(dp).split('.');
  return `${neg ? '-' : ''}${group(i)}${d ? `.${d}` : ''}`;
};
const parseIso = (iso) => { const s = String(iso).slice(0, 10); const [y, m, d] = s.split('-').map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };

export const fmt = {
  peso: (n, dp = 2) => (n == null || Number.isNaN(+n) ? '—' : `${n < 0 ? '-' : ''}₱${fixed(Math.abs(+n), dp)}`),
  num: (n, dp = 1) => (n == null || Number.isNaN(+n) ? '—' : fixed(+n, dp)),
  int: (n) => (n == null || Number.isNaN(+n) ? '—' : fixed(Math.round(+n), 0)),
  signedPeso: (n) => (n == null || Number.isNaN(+n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}₱${Math.abs(n).toFixed(2)}`),
  dur: (min) => {
    if (min == null) return '—';
    const m = Math.round(min);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  },
  /** 'Oct 20, 2026' · opts: { weekday, long, year: false, day: false } */
  date: (iso, opts = {}) => {
    if (!iso) return '—';
    const { y, m, d, dow } = parseIso(iso);
    const mon = opts.long ? MONTHS_LONG[m - 1] : MONTHS[m - 1];
    let out = opts.day === false ? mon : `${mon} ${d}`;
    if (opts.year !== false) out += opts.day === false ? ` ${y}` : `, ${y}`;
    if (opts.shortYear) out = `${mon} '${String(y).slice(2)}`;
    if (opts.weekday) out = `${opts.weekday === 'short' ? DAYS[dow].slice(0, 3) : DAYS[dow]}, ${out}`;
    return out;
  },
  week: (start, end) => {
    if (!start) return '—';
    const a = parseIso(start);
    if (!end) return fmt.date(start);
    const b = parseIso(end);
    return a.m === b.m ? `${MONTHS[a.m - 1]} ${a.d}–${b.d}, ${b.y}` : `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  },
  ago: (ts) => {
    if (!ts) return '—';
    const t = new Date(String(ts).includes('T') ? ts : `${String(ts).replace(' ', 'T')}Z`);
    const s = (Date.now() - t) / 1000;
    if (s < 0) return 'soon';
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return fmt.date(t.toISOString());
  },
};

export const PRODUCT_LABELS = {
  RON91: 'RON 91 (Regular)', RON95: 'RON 95 (Premium)', RON97_100: 'RON 97/100', RON97: 'RON 97', RON100: 'RON 100',
  DIESEL: 'Diesel', DIESEL_PLUS: 'Diesel Plus', KEROSENE: 'Kerosene', ELECTRICITY: 'Electricity',
};
export const SHORT_PRODUCT = { RON91: 'RON91', RON95: 'RON95', RON97_100: 'RON97/100', RON97: 'RON97', RON100: 'RON100', DIESEL: 'Diesel', DIESEL_PLUS: 'Diesel+', KEROSENE: 'Kerosene', ELECTRICITY: 'kWh' };
export const REGIONS = ['NCR', 'North Luzon', 'South Luzon', 'Visayas', 'Mindanao'];
export const FUEL_PRODUCTS = ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS'];
export const isoToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
