// Fuel Prices: official DOE prices by region, organised in four tabs — this week, history,
// by city & brand, and weekly adjustments. Any past week back to 2017 can be opened.
import { PRODUCT_LABELS, REGIONS, SERIES_COLORS, SHORT_PRODUCT, alertBox, api, brandColor, clear, empty, fmt, h, icon, loading, makeChart, setQuery, state, store, toast } from '../lib.js';
import { pageHeader, section, tabBar, term, tip } from '../ui.js';

const COLS = ['RON91', 'RON95', 'RON97_100', 'RON97', 'RON100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'];
const HIST_PRODUCTS = ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'];
const RANGES = [['26', '6M'], ['52', '1Y'], ['156', '3Y'], ['260', '5Y'], ['all', 'All']];
const VIEWS = ['week', 'history', 'cities', 'adjust'];

const HELP = {
  intro: 'Official retail pump prices from the Department of Energy (DOE). DOE checks stations every week and publishes the results; TipidLitro reads those reports automatically.',
  steps: [
    'Pick a region at the top (NCR has the most detail: every city and brand).',
    '"This week" shows the price most stations charge for each fuel, and how it changed.',
    '"History" shows prices over time, back to 2017. You can download the numbers as a CSV file.',
    '"By city & brand" shows which city and which brand is cheapest.',
    '"Adjustments" shows the weekly price changes oil companies announce every Monday.',
    'Want an older week? On "This week", tap "Change week".',
  ],
  terms: ['common', 'range', 'ron', 'dieselPlus', 'adjustment', 'rollback', 'estimate'],
};

/** Green (cheap) → red (expensive) background relative to the column's min/max. */
function heat(v, min, max) {
  if (v == null || max === min) return {};
  const t = (v - min) / (max - min);
  return { background: `hsla(${145 - t * 140}, 70%, 45%, .16)` };
}
const yearsAgo = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const daysBefore = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);

export async function render(root, params) {
  let region = REGIONS.includes(params.region) ? params.region : 'NCR';
  let week = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? params.week : '';
  let compare = params.compare || '';
  let view = VIEWS.includes(params.view) ? params.view : 'week';
  let pickerOpen = Boolean(week || compare);
  const charts = [];
  let D = null; // last loaded data
  const checkBox = h('div', { class: 'row', style: { gap: '8px' } });
  const body = h('div', { class: 'cards-gap' });
  const viewTabsBox = h('div');
  const sync = () => setQuery({ region: region === 'NCR' ? null : region, view: view === 'week' ? null : view, week: week || null, compare: compare || null });

  root.append(
    pageHeader({ title: 'Fuel prices', subtitle: 'Official DOE pump prices — this week and every week back to 2017.', actions: checkBox, help: HELP }),
    tabBar(REGIONS.map((r) => [r, r]), region, (r) => { region = r; week = ''; compare = ''; pickerOpen = false; sync(); load(); }, { variant: 'pills' }),
    viewTabsBox, body);

  function drawViewTabs() {
    clear(viewTabsBox).append(tabBar([['week', 'This week'], ['history', 'History'], ['cities', region === 'NCR' ? 'By city & brand' : 'By report'], ['adjust', 'Adjustments']], view, (k) => { view = k; sync(); drawView(); }));
  }

  // ---------------------------------------------------------- "check DOE now"
  function drawCheck() {
    const st = state.status?.doe;
    clear(checkBox).append(
      h('span', { class: 'muted', style: { fontSize: '.82rem' } }, st?.checkedAt ? `Checked DOE ${fmt.ago(st.checkedAt)}` : 'Checks DOE every hour', tip('TipidLitro looks for new DOE reports every hour automatically. You can also check right now.')),
      h('button', { class: 'btn small', type: 'button', onClick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Checking…';
        try {
          const r = await api('/prices/check', { method: 'POST' });
          if (r.status === 'recent') toast(`Already checked ${fmt.ago(r.checkedAt)} — nothing newer yet`);
          else if (r.status === 'running') toast('A check is already running');
          else if (/imported [1-9]/.test(r.message || '')) toast('New DOE data imported!');
          else toast('Up to date — no new DOE reports');
          state.status = await api('/status');
          window.tlRefreshTicker?.();
          load();
        } catch (err) { toast(err.message, 'error'); }
        drawCheck();
      } }, icon('refresh'), 'Check DOE now'));
  }

  async function load() {
    drawCheck(); drawViewTabs();
    charts.splice(0).forEach((c) => c.destroy());
    clear(body).append(loading('Loading DOE prices…'));
    try {
      const qs = new URLSearchParams({ ...(week ? { week } : {}), ...(compare ? { compare } : {}) });
      const [data, adj, weeks] = await Promise.all([
        api(`/prices/region/${encodeURIComponent(region)}?${qs}`),
        api('/prices/adjustments?weeks=52'),
        api(`/prices/weeks?region=${encodeURIComponent(region)}`),
      ]);
      D = { data, adj, weeks };
    } catch (e) { clear(body).append(alertBox('danger', e.message)); return; }
    drawView();
  }

  function drawView() {
    charts.splice(0).forEach((c) => c.destroy());
    clear(body);
    if (!D.data.summary.weekStart) {
      body.append(h('div', { class: 'card' }, empty('⛽', `No ${region} prices yet`, 'TipidLitro is still downloading DOE reports. Try again in a minute, or press "Check DOE now".')));
      return;
    }
    ({ week: viewWeek, history: viewHistory, cities: viewCities, adjust: viewAdjust })[view]();
  }

  // ---------------------------------------------------------- This week
  function viewWeek() {
    const { data, weeks, adj } = D; const s = data.summary;
    const weekSel = h('select', null, weeks.weeks.map((w, i) => h('option', { value: i === 0 ? '' : w.weekStart }, `${fmt.week(w.weekStart, w.weekEnd)}${i === 0 ? ' (latest)' : ''}`)));
    weekSel.value = s.isLatest ? '' : s.weekStart;
    const cmpOpts = [['', 'the week before'], [daysBefore(s.weekStart, 28), '4 weeks before'], [yearsAgo(s.weekStart, 1), '1 year before'], [yearsAgo(s.weekStart, 3), '3 years before'], [yearsAgo(s.weekStart, 5), '5 years before']];
    const cmpSel = h('select', null, cmpOpts.map(([v, t]) => h('option', { value: v }, t)), h('optgroup', { label: 'A specific week' }, weeks.weeks.map((w) => h('option', { value: w.weekStart }, fmt.week(w.weekStart, w.weekEnd)))));
    cmpSel.value = compare;
    weekSel.addEventListener('change', () => { week = weekSel.value; sync(); load(); });
    cmpSel.addEventListener('change', () => { compare = cmpSel.value; sync(); load(); });
    const first = weeks.weeks[weeks.weeks.length - 1];
    const picker = h('div', { class: `week-bar ${pickerOpen ? '' : 'hidden'}`, style: { marginTop: '12px' } },
      h('div', { class: 'field' }, h('label', null, 'Show week'), weekSel),
      h('div', { class: 'field' }, h('label', null, 'Compare with'), cmpSel),
      h('span', { class: 'muted', style: { fontSize: '.8rem' } }, `${weeks.weeks.length} weeks on file${first ? ` since ${fmt.date(first.weekStart)}` : ''}`));

    body.append(h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('div', null,
          h('h2', { style: { margin: 0 } }, `Week of ${fmt.week(s.weekStart, s.weekEnd)}`),
          h('p', { class: 'muted', style: { margin: '2px 0 0', fontSize: '.86rem' } },
            s.isLatest ? 'The latest DOE report on file. ' : 'A past week. ',
            s.estimated ? ['Regional prices are ', term('estimate', 'estimates'), ' from the field office report. '] : null,
            s.sourceUrl?.startsWith('http') ? h('a', { href: s.sourceUrl, target: '_blank', rel: 'noopener' }, 'Source PDF ', icon('external')) : null)),
        h('div', { class: 'row', style: { gap: '6px' } },
          !s.isLatest ? h('span', { class: 'badge blue' }, 'Past week') : s.stale ? h('span', { class: 'badge amber' }, `${s.ageDays} days old`) : h('span', { class: 'badge green' }, 'Latest'),
          !s.isLatest || compare ? h('button', { class: 'btn small', type: 'button', onClick: () => { week = ''; compare = ''; pickerOpen = false; sync(); load(); } }, 'Back to latest') : null,
          h('button', { class: 'btn small', type: 'button', onClick: (e) => { pickerOpen = !pickerOpen; picker.classList.toggle('hidden', !pickerOpen); e.currentTarget.lastChild.textContent = pickerOpen ? 'Hide' : 'Change week'; } }, icon('calendar'), pickerOpen ? 'Hide' : 'Change week'))),
      picker,
      h('div', { class: 'legend-row', style: { marginTop: '10px' } }, h('span', null, h('b', null, 'Big number'), ' = ', term('common')), h('span', null, h('b', null, 'Range'), tip('Cheapest to most expensive station DOE saw that week.')), h('span', null, '▲▼ = change vs ', s.compareWeek ? fmt.date(s.compareWeek) : 'the week before'))));

    body.append(h('div', { class: 'grid cols-auto' }, s.products.map((p) => h('div', { class: 'card price-card' },
      h('div', { class: 'label' }, p.label),
      h('div', { class: 'price' }, fmt.peso(p.common)),
      h('div', { class: 'range' }, `${fmt.peso(p.min)} – ${fmt.peso(p.max)}`),
      p.change != null ? h('div', { class: `change ${p.change > 0 ? 'up' : p.change < 0 ? 'down' : ''}` }, `${p.change > 0 ? '▲' : p.change < 0 ? '▼' : '•'} ${fmt.signedPeso(p.change)}`,
        compare && p.compareCommon ? h('span', { class: 'faint', style: { fontWeight: 400 } }, ` (was ${fmt.peso(p.compareCommon)}, ${p.change >= 0 ? '+' : ''}${((p.change / p.compareCommon) * 100).toFixed(1)}%)`) : null) : null))));

    const w0 = adj.weeks[0];
    if (w0 && s.isLatest) {
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('div', null, h('h3', { style: { margin: 0 } }, icon('bolt'), ' Latest price adjustment ', tip('Oil companies change prices every Tuesday at 6 AM. This is the most recent change, per liter.')),
            h('p', { class: 'muted', style: { margin: '2px 0 0', fontSize: '.86rem' } }, `Took effect ${fmt.date(w0.weekStart, { weekday: 'long', month: 'long', day: 'numeric' })}`)),
          h('button', { class: 'btn small', type: 'button', onClick: () => { view = 'adjust'; sync(); drawViewTabs(); drawView(); } }, 'All adjustments')),
        h('div', { class: 'row', style: { gap: '28px', marginTop: '10px' } }, ['GASOLINE', 'DIESEL', 'KEROSENE'].map((k) => h('div', null,
          h('div', { class: 'muted', style: { fontSize: '.8rem', fontWeight: 600 } }, k[0] + k.slice(1).toLowerCase()),
          h('div', { class: `kpi ${w0[k] > 0 ? 'up' : w0[k] < 0 ? 'down' : ''}` }, w0[k] == null ? '—' : `${w0[k] > 0 ? '▲' : w0[k] < 0 ? '▼' : ''} ${fmt.signedPeso(w0[k])}`)))),
        h('p', { class: 'faint', style: { fontSize: '.8rem', margin: '8px 0 0' } }, 'Want to know next week\'s change? See ', h('a', { href: '#/watch' }, 'Price Watch'), '.')));
    }
  }

  // ---------------------------------------------------------- History
  function viewHistory() {
    const { weeks } = D;
    const canvas = h('canvas');
    const picked = new Set(store.get('histProducts', ['RON91', 'RON95', 'DIESEL']));
    const areaSel = h('select', { style: { width: 'auto', minHeight: '34px', padding: '5px 10px' } }, h('option', { value: '' }, `${region} (all)`), weeks.areas.filter((a) => a.weeks > 1).map((a) => h('option', { value: a.area }, a.area)));
    const rangeChips = h('div', { class: 'range-chips' }, RANGES.map(([k, label]) => h('button', { class: `chip ${k === store.get('histRange', '52') ? 'on' : ''}`, type: 'button', onClick: (e) => { store.set('histRange', k); [...rangeChips.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); draw(); } }, label)));
    const prodChips = h('div', { class: 'chips' }, HIST_PRODUCTS.map((p) => h('button', { class: `chip ${picked.has(p) ? 'on' : ''}`, type: 'button', onClick: (e) => { picked.has(p) ? picked.delete(p) : picked.add(p); e.currentTarget.classList.toggle('on'); store.set('histProducts', [...picked]); draw(); } }, SHORT_PRODUCT[p])));
    const note = h('p', { class: 'faint', style: { fontSize: '.78rem', margin: '6px 0 0' } });
    const csvLink = h('a', { class: 'btn small', href: '#', download: '' }, icon('download'), 'Download CSV');
    const stats = h('div', { class: 'stack', style: { gap: '4px', margin: '6px 0 10px', fontSize: '.84rem' } });
    body.append(section({ title: `${region} price history`, icon: 'trend', desc: 'The common price each week. Tap a fuel to show or hide it; pick a time range or a city.', actions: [areaSel, csvLink] },
      h('div', { class: 'row between', style: { marginBottom: '8px' } }, prodChips, rangeChips), stats, h('div', { class: 'chart-box tall' }, canvas), note));
    let chart = null;
    async function draw() {
      const r = store.get('histRange', '52');
      const area = areaSel.value;
      const n = r === 'all' ? 1000 : Number(r);
      const prods = HIST_PRODUCTS.filter((p) => picked.has(p));
      csvLink.href = `/api/prices/export.csv?region=${encodeURIComponent(region)}${area ? `&area=${encodeURIComponent(area)}` : ''}${r === 'all' ? '' : `&from=${new Date(Date.now() - n * 7 * 86400000).toISOString().slice(0, 10)}`}`;
      if (!prods.length) { chart?.destroy(); chart = null; clear(stats); return; }
      let hist;
      try { hist = await api(`/prices/history?region=${encodeURIComponent(region)}&products=${prods.join(',')}&weeks=${n}${area ? `&area=${encodeURIComponent(area)}` : ''}`); } catch { return; }
      const series = Object.entries(hist.series).filter(([, rows]) => rows.length);
      const labels = [...new Set(series.flatMap(([, rows]) => rows.map((x) => x.week_start)))].sort();
      chart?.destroy();
      const idx = charts.indexOf(chart); if (idx >= 0) charts.splice(idx, 1);
      chart = makeChart(canvas, {
        type: 'line',
        data: { labels: labels.map((l) => fmt.date(l, { month: 'short', day: labels.length > 60 ? undefined : 'numeric', year: '2-digit' })), datasets: series.map(([p, rows]) => { const i = HIST_PRODUCTS.indexOf(p); return { label: PRODUCT_LABELS[p], data: labels.map((l) => rows.find((x) => x.week_start === l)?.common ?? null), borderColor: SERIES_COLORS[i], backgroundColor: SERIES_COLORS[i], tension: 0.2, spanGaps: true, pointRadius: labels.length > 60 ? 0 : 2, borderWidth: 2 }; }) },
        options: { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: '₱ per liter' } } }, plugins: { tooltip: { callbacks: { title: (it) => `Week of ${fmt.date(labels[it[0].dataIndex])}`, label: (c) => `${c.dataset.label}: ${fmt.peso(c.raw)}` } } } },
      });
      charts.push(chart);
      clear(stats);
      for (const [p, rows] of series) {
        const ok = rows.filter((x) => x.common != null); if (ok.length < 2) continue;
        const a = ok[0]; const b = ok[ok.length - 1]; const lo = ok.reduce((m, x) => (x.common < m.common ? x : m)); const hi = ok.reduce((m, x) => (x.common > m.common ? x : m));
        stats.append(h('div', null, h('span', { class: 'brand-dot', style: { background: SERIES_COLORS[HIST_PRODUCTS.indexOf(p)], marginRight: '6px' } }), h('b', null, SHORT_PRODUCT[p]), `: ${fmt.peso(a.common)} → ${fmt.peso(b.common)} `, h('span', { class: b.common > a.common ? 'up' : 'down' }, `(${fmt.signedPeso(b.common - a.common)})`), h('span', { class: 'muted' }, ` · lowest ${fmt.peso(lo.common)} (${fmt.date(lo.week_start, { month: 'short', year: 'numeric' })}) · highest ${fmt.peso(hi.common)} (${fmt.date(hi.week_start, { month: 'short', year: 'numeric' })})`)));
      }
      note.textContent = labels.length < 8
        ? 'Only a few weeks are stored so far. An admin can import DOE history back to 2017 from the Integration Monitor.'
        : `${labels.length} weekly DOE reports${area ? ` for ${area}` : ''}. Gaps are weeks DOE didn't publish or that couldn't be read.`;
    }
    areaSel.addEventListener('change', draw);
    draw();
  }

  // ---------------------------------------------------------- By city & brand
  function viewCities() {
    const { data } = D; const s = data.summary;
    if (!data.areas.length) { body.append(h('div', { class: 'card' }, empty('🗺️', 'No breakdown for this week', 'DOE did not publish city-level prices for this region and week.'))); return; }
    const cols = COLS.filter((c) => data.areas.some((a) => a.products[c]));
    const ranges = Object.fromEntries(cols.map((c) => { const v = data.areas.map((a) => a.products[c]?.common).filter((x) => x != null); return [c, [Math.min(...v), Math.max(...v)]]; }));
    const brandBox = h('div');
    let selected = null;
    const rows = data.areas.map((a) => {
      const tr = h('tr', { class: 'click', onClick: () => { selected = a.area; [...tbody.children].forEach((x) => x.classList.toggle('sel', x === tr)); drawBrands(); } },
        h('td', null, a.area), cols.map((c) => { const v = a.products[c]?.common; return h('td', null, v == null ? '—' : h('span', { class: 'heat', style: heat(v, ...ranges[c]), title: `Range ${fmt.peso(a.products[c].min)}–${fmt.peso(a.products[c].max)}${a.products[c].estimate ? ' (no DOE common price; median of brands)' : ''}` }, fmt.num(v, 2), a.products[c].estimate ? '*' : '')); }));
      return tr;
    });
    const tbody = h('tbody', null, rows);
    body.append(section({ title: region === 'NCR' ? 'Common price by city' : 'By field office report', icon: 'pin', desc: `Week of ${fmt.week(s.weekStart, s.weekEnd)} · ₱ per liter · greener = cheaper.${data.brands.length ? ' Tap a city to see each brand.' : ''}` },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Area'), cols.map((c) => h('th', null, SHORT_PRODUCT[c])))), tbody)),
      h('p', { class: 'faint', style: { fontSize: '.78rem', margin: '6px 0 0' } }, '* DOE listed no common price; the value is the middle of the brand prices.')));
    body.append(brandBox);

    const drawBrands = () => {
      clear(brandBox);
      if (!selected) return;
      const list = data.brands.filter((b) => b.area === selected);
      if (!list.length) return;
      const brands = [...new Set(list.map((b) => b.brand))];
      const pcols = COLS.filter((c) => list.some((b) => b.product === c));
      const mids = Object.fromEntries(pcols.map((c) => { const v = list.filter((b) => b.product === c).map((b) => (b.min + b.max) / 2); return [c, [Math.min(...v), Math.max(...v)]]; }));
      brandBox.append(section({ title: `${selected}: prices by brand`, icon: 'fuel', desc: 'Lowest–highest price DOE recorded for each brand in this city. "Independent" covers smaller brands.' },
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Brand'), pcols.map((c) => h('th', null, SHORT_PRODUCT[c])))),
          h('tbody', null, brands.map((b) => h('tr', null, h('td', null, h('span', { class: 'brand-dot', style: { background: brandColor(b), marginRight: '6px' } }), b),
            pcols.map((c) => { const x = list.find((y) => y.brand === b && y.product === c); return h('td', null, x ? h('span', { class: 'heat', style: heat((x.min + x.max) / 2, ...mids[c]) }, x.min === x.max ? fmt.num(x.min, 2) : `${fmt.num(x.min, 2)}–${fmt.num(x.max, 2)}`) : '—'); }))))))));
    };
    if (data.brands.length) { selected = data.areas[0].area; rows[0].classList.add('sel'); drawBrands(); }
  }

  // ---------------------------------------------------------- Adjustments
  function viewAdjust() {
    const { adj } = D;
    const latest = adj.latest; const weeks = adj.weeks;
    if (!weeks.length) { body.append(h('div', { class: 'card' }, empty('📉', 'No adjustment notices yet', 'They are imported from DOE every hour.'))); return; }
    const w0 = weeks[0];
    const total = (k) => weeks.reduce((sum, w) => sum + (w[k] || 0), 0);
    const canvas = h('canvas');
    body.append(h('div', { class: 'grid cols-2' },
      section({ title: `Effective ${fmt.date(w0.weekStart, { weekday: 'short', month: 'short', day: 'numeric' })}`, icon: 'bolt', desc: 'Change per liter announced by oil companies. Independent stations may differ.' },
        h('div', { class: 'row', style: { gap: '28px', margin: '4px 0 10px' } }, ['GASOLINE', 'DIESEL', 'KEROSENE'].map((k) => h('div', null,
          h('div', { class: 'muted', style: { fontSize: '.8rem', fontWeight: 600 } }, k[0] + k.slice(1).toLowerCase()),
          h('div', { class: `kpi ${w0[k] > 0 ? 'up' : w0[k] < 0 ? 'down' : ''}` }, w0[k] == null ? '—' : `${w0[k] > 0 ? '▲' : w0[k] < 0 ? '▼' : ''} ${fmt.signedPeso(w0[k])}`)))),
        h('p', { class: 'muted', style: { fontSize: '.84rem' } }, `Over the last ${weeks.length} notices, the net change is gasoline ${fmt.signedPeso(total('GASOLINE'))}, diesel ${fmt.signedPeso(total('DIESEL'))}, kerosene ${fmt.signedPeso(total('KEROSENE'))} per liter.`,
          latest.sourceUrl ? [' ', h('a', { href: latest.sourceUrl, target: '_blank', rel: 'noopener' }, 'Source PDF')] : null),
        latest.companies.length ? h('details', null, h('summary', { style: { cursor: 'pointer', fontWeight: 600, margin: '6px 0' } }, `By oil company (${latest.companies.length})`),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, 'Company'), h('th', null, 'Gasoline'), h('th', null, 'Diesel'), h('th', null, 'Kerosene'))),
            h('tbody', null, latest.companies.map((c) => h('tr', null, h('td', null, c.company), ...['GASOLINE', 'DIESEL', 'KEROSENE'].map((k) => h('td', { class: c[k] > 0 ? 'up' : c[k] < 0 ? 'down' : '' }, c[k] == null ? '—' : fmt.signedPeso(c[k]))))))))) : null),
      section({ title: 'Week by week', icon: 'trend', desc: 'Bars above zero are price hikes; below zero are rollbacks.' }, h('div', { class: 'chart-box tall' }, canvas))));
    const ws = [...weeks].reverse().slice(-26);
    charts.push(makeChart(canvas, {
      type: 'bar',
      data: { labels: ws.map((w) => fmt.date(w.weekStart, { month: 'short', day: 'numeric' })), datasets: [['GASOLINE', 'Gasoline', SERIES_COLORS[0]], ['DIESEL', 'Diesel', SERIES_COLORS[1]], ['KEROSENE', 'Kerosene', '#94a3b8']].map(([k, label, color]) => ({ label, data: ws.map((w) => w[k]), backgroundColor: color, borderRadius: 4 })) },
      options: { scales: { y: { title: { display: true, text: '₱ per liter' } } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.signedPeso(c.raw)}` } } } },
    }));
  }

  await load();
  return () => charts.forEach((c) => c.destroy());
}
