// Price Watch: a plain answer first ("next Tuesday, gasoline likely down ₱1.75"), with the
// drivers, charts, accuracy and method in collapsible sections below.
import { alertBox, api, clear, fmt, h, loading, makeChart } from '../lib.js';
import { pageHeader, section, term, tip } from '../ui.js';

const NAMES = { GASOLINE: 'Gasoline', DIESEL: 'Diesel', KEROSENE: 'Kerosene' };
const HELP = {
  intro: 'Philippine pump prices change every Tuesday. Price Watch estimates next Tuesday\'s change so you can decide whether to fill up now or wait.',
  steps: [
    'Read the answer at the top: whether prices will likely go up or down, and by about how much per liter.',
    'Follow the tip: fill up before Tuesday if a hike is coming, or wait for a rollback if your tank allows.',
    'On Monday, oil companies announce the official numbers; Price Watch switches to those automatically.',
    'Curious why? Open "What is driving it" and "How accurate is this?".',
  ],
  terms: ['rollback', 'adjustment', 'brent', 'mops', 'confidence', 'pressure'],
};

export async function render(root) {
  const charts = [];
  root.append(pageHeader({ title: 'Price Watch', subtitle: 'Will pump prices go up or down next Tuesday?', help: HELP }));
  const body = h('div', { class: 'cards-gap' }, loading('Checking oil prices and past adjustments…'));
  root.append(body);

  let f; let market;
  try { [f, market] = await Promise.all([api('/forecast'), api('/market?days=150')]); } catch (e) { clear(body).append(alertBox('warn', `The estimate is not available yet: ${e.message}`)); return undefined; }
  clear(body);

  const daysLeft = Math.max(0, Math.round((new Date(`${f.targetWeekStart}T06:00:00+08:00`) - Date.now()) / 86400000));
  const when = fmt.date(f.targetWeekStart, { weekday: 'long', month: 'long', day: 'numeric' });
  const value = (p) => p.announced ?? p.estimate;
  const word = (v) => (v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'about the same');
  const gas = f.products.find((p) => p.product === 'GASOLINE'); const dsl = f.products.find((p) => p.product === 'DIESEL');
  const announced = f.products.some((p) => p.announced != null);

  // The answer
  body.append(h('div', { class: 'card welcome' },
    h('div', { class: 'section-title' }, announced ? 'Announced by oil companies' : `Estimate · ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`}`),
    h('h2', { style: { margin: '0 0 10px' } }, `Next price change: ${when}`),
    h('div', { class: 'answer' }, f.products.map((p) => {
      const v = value(p);
      return h('div', { class: 'answer-line' }, h('span', { style: { minWidth: '86px', fontWeight: 600 } }, NAMES[p.product]),
        h('b', { class: `big ${v > 0.05 ? 'up' : v < -0.05 ? 'down' : ''}` }, `${v > 0.05 ? '▲' : v < -0.05 ? '▼' : '≈'} ${fmt.signedPeso(v)}`),
        h('span', { class: 'muted' }, `per liter — likely ${word(v)}`, p.announced == null ? ` (between ${fmt.signedPeso(p.low)} and ${fmt.signedPeso(p.high)})` : ''));
    })),
    [gas, dsl].filter(Boolean).map((p) => h('div', { class: `advice ${p.advice.action}`, style: { marginTop: '10px' } },
      h('span', { style: { fontSize: '1.4rem' } }, p.advice.action === 'fill_now' ? '⛽' : p.advice.action === 'wait' ? '⏳' : '👌'),
      h('div', null, h('div', { style: { fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.7 } }, `${NAMES[p.product]} tip`), p.advice.text))),
    h('p', { class: 'muted', style: { fontSize: '.82rem', margin: '10px 0 0' } },
      announced ? 'These are the official amounts filed with DOE. ' : ['This is an estimate, not the official number. ', term('confidence', 'Confidence'), `: ${gas?.confidence || 'low'}. Oil companies announce the real change on Monday. `],
      f.basis.lagged ? `Latest free oil data is from ${fmt.date(f.basis.latestBrentDate)}, so treat it as a rough guide.` : '')));

  // What it means at the pump
  body.append(section({ title: 'What it means at the pump (NCR)', icon: 'fuel', desc: 'This week\'s common price and what it becomes if the change happens.' },
    h('div', { class: 'grid cols-3' }, f.products.map((p) => h('div', { class: 'stat' },
      h('div', { class: 'k' }, NAMES[p.product]),
      p.pumps.length ? p.pumps.map((x) => h('div', { class: 'row between', style: { fontSize: '.88rem' } }, h('span', null, x.product === 'RON97_100' ? 'RON97/100' : x.product.replace('_', ' ')), h('span', { class: 'num' }, `${fmt.peso(x.current)} → `, h('b', null, fmt.peso(x.projected))))) : h('div', { class: 's' }, 'No NCR price on file'))))));

  // Drivers
  const b = f.basis; const pr = f.pressure;
  body.append(section({ title: 'What is driving it', icon: 'trend', desc: 'Pump prices follow world oil prices and the peso, with about a week\'s delay.', collapsible: true, open: false },
    h('table', { class: 'breakdown' }, h('tbody', null,
      h('tr', null, h('td', null, h('span', { class: 'term' }, 'World oil price (Brent)', tip('Average of the latest trading days vs the week before, US dollars per barrel.')), h('small', { class: 'muted' }, b.window)), h('td', null, `$${fmt.num(b.brentPrevAvg, 2)} → $${fmt.num(b.brentAvg, 2)}`)),
      h('tr', null, h('td', null, 'US dollar in pesos', h('small', { class: 'muted' }, 'A weaker peso makes imported fuel more expensive')), h('td', null, `₱${fmt.num(b.fxPrevAvg, 2)} → ₱${fmt.num(b.fxAvg, 2)}`)),
      h('tr', null, h('td', null, 'Crude oil cost per liter', h('small', { class: 'muted' }, 'Brent × USD/PHP ÷ 159 liters in a barrel')), h('td', null, `${fmt.peso(b.crudePhpPerLPrev)} → ${fmt.peso(b.crudePhpPerL)}`)),
      h('tr', null, h('td', null, h('b', null, 'Change in crude cost')), h('td', null, h('b', null, fmt.signedPeso(b.rawDelta)))))),
    pr ? h('div', { style: { marginTop: '14px' } },
      h('div', { class: 'row between', style: { fontSize: '.85rem', marginBottom: '6px' } }, h('b', null, term('pressure', 'News headlines this week')), h('span', { class: 'muted' }, `${pr.up} point up · ${pr.down} point down`)),
      h('div', { class: 'gauge' }, h('div', { class: 'g-up', style: { width: `${pr.up + pr.down ? (pr.up / (pr.up + pr.down)) * 100 : 50}%` } }), h('div', { class: 'g-down', style: { flex: 1 } })),
      h('p', { class: 'faint', style: { fontSize: '.78rem', marginTop: '6px' } }, 'Context only — headlines are not used in the number. ', h('a', { href: '#/news' }, 'Read the news'))) : null));

  const brentCanvas = h('canvas'); const fxCanvas = h('canvas'); const fitCanvas = h('canvas');
  body.append(section({ title: 'Oil price and peso charts', icon: 'trend', desc: 'Last 5 months.', collapsible: true, open: false },
    h('div', { class: 'charts-2' }, h('div', null, h('div', { class: 'section-title' }, 'Brent crude (US$ per barrel)'), h('div', { class: 'chart-box tall' }, brentCanvas)),
      h('div', null, h('div', { class: 'section-title' }, 'US dollar in pesos'), h('div', { class: 'chart-box tall' }, fxCanvas)))));
  body.append(section({ title: 'How accurate is this?', icon: 'info', desc: 'Bars are the real weekly changes; dashed lines are what the model would have said.', collapsible: true, open: false },
    h('div', { class: 'chart-box tall' }, fitCanvas),
    h('p', { class: 'muted', style: { fontSize: '.8rem' } }, f.products.map((p) => `${NAMES[p.product]}: ${p.calibration.calibrated ? `learned from ${p.calibration.n} weeks, usually within ±₱${p.calibration.rmse}` : 'not enough history yet'}`).join(' · '))));
  body.append(section({ title: 'How we estimate', icon: 'info', collapsible: true, open: false },
    h('div', { style: { fontSize: '.9rem' } },
      h('p', null, 'Oil companies set Tuesday\'s change from the previous week\'s average Singapore fuel prices (MOPS). MOPS is paid data, so TipidLitro uses the free Brent crude price and the USD/PHP rate instead.'),
      h('p', null, 'We compare this week\'s crude cost per liter with last week\'s, then adjust using what actually happened in past weeks (a simple model per fuel, learned from DOE\'s adjustment notices). The range shows the model\'s typical error.'),
      h('p', null, 'Gasoline and diesel do not always follow crude — taxes, subsidies and refinery issues can change things. On Monday the official numbers replace this estimate.'))));

  // Charts in collapsed sections are built the first time the section opens (so they size correctly).
  const ws = [...new Set(f.history.map((x) => x.weekStart))];
  const pick = (w, p, k) => f.history.find((x) => x.weekStart === w && x.product === p)?.[k] ?? null;
  const lazy = (canvas, build) => {
    const det = canvas.closest('details');
    const make = () => { if (!canvas.dataset.done) { canvas.dataset.done = '1'; charts.push(build()); } };
    if (!det || det.open) make(); else det.addEventListener('toggle', () => { if (det.open) make(); });
  };
  lazy(fitCanvas, () => makeChart(fitCanvas, {
    type: 'bar',
    data: {
      labels: ws.map((w) => fmt.date(w, { month: 'short', day: 'numeric' })),
      datasets: [
        { type: 'bar', label: 'Gasoline (actual)', data: ws.map((w) => pick(w, 'GASOLINE', 'actual')), backgroundColor: 'rgba(234,88,12,.75)', borderRadius: 4 },
        { type: 'line', label: 'Gasoline (model)', data: ws.map((w) => pick(w, 'GASOLINE', 'predicted')), borderColor: '#ea580c', borderDash: [5, 4], pointRadius: 3 },
        { type: 'bar', label: 'Diesel (actual)', data: ws.map((w) => pick(w, 'DIESEL', 'actual')), backgroundColor: 'rgba(14,165,233,.75)', borderRadius: 4 },
        { type: 'line', label: 'Diesel (model)', data: ws.map((w) => pick(w, 'DIESEL', 'predicted')), borderColor: '#0ea5e9', borderDash: [5, 4], pointRadius: 3 },
      ],
    },
    options: { scales: { y: { title: { display: true, text: '₱ per liter' } } } },
  }));
  const line = (canvas, rows, label, color, prefix) => lazy(canvas, () => makeChart(canvas, {
    type: 'line',
    data: { labels: rows.map((r) => fmt.date(r.date, { month: 'short', day: 'numeric' })), datasets: [{ label, data: rows.map((r) => r.value), borderColor: color, backgroundColor: color, pointRadius: 0, tension: 0.2, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${prefix}${fmt.num(c.raw, 2)}` } } }, scales: { x: { ticks: { maxTicksLimit: 8 } } } },
  }));
  line(brentCanvas, market.brent, 'Brent', '#ea580c', '$');
  line(fxCanvas, market.usdphp, 'USD/PHP', '#2563eb', '₱');

  return () => charts.forEach((c) => c.destroy());
}
