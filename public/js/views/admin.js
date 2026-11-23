// Integration Monitor (admins): a tabbed dashboard — overview, integrations, data & jobs, usage,
// users & reports, tools, and system — with charts and plain explanations of each part.
import { REGIONS, SERIES_COLORS, alertBox, api, clear, empty, fmt, h, icon, loading, makeChart, modal, setQuery, state, toast } from '../lib.js';
import { kpi, pageHeader, section, tabBar, term, tip } from '../ui.js';

const STATUS_TEXT = { healthy: 'Healthy', degraded: 'Some errors', down: 'Failing', idle: 'No calls yet', client: 'Runs in the browser', not_configured: 'No API key' };
const STATUS_HELP = {
  healthy: 'Answering normally.',
  degraded: 'Working, but some recent calls failed.',
  down: 'The most recent calls failed. Features using it fall back or show an error.',
  idle: 'Not called yet (it is only used when someone needs it).',
  client: 'Used directly by the visitor\'s browser, so the server cannot measure it.',
  not_configured: 'Optional; needs an API key in .env.',
};
const TABS = [['overview', 'Overview'], ['integrations', 'Integrations'], ['data', 'Data & jobs'], ['usage', 'Usage'], ['users', 'Users & reports'], ['tools', 'Tools'], ['system', 'System']];
const HELP = {
  intro: 'The Integration Monitor shows how TipidLitro\'s connections to outside systems are doing, keeps the data pipeline running, and gives you usage numbers for reporting.',
  steps: [
    'Overview: anything that needs attention, plus headline numbers.',
    'Integrations: each outside system (DOE, maps, weather, news…) with speed and reliability charts. Click a card for its recent calls.',
    'Data & jobs: how fresh the prices are, how much history is stored, and the automatic jobs. You can run a job now or import more history.',
    'Usage: anonymous statistics about trips and assistant questions.',
    'Users & reports: change roles and remove bad community price reports.',
    'Tools: type in prices by hand when a DOE report cannot be read. System: server details and settings.',
  ],
  terms: ['integration', 'latency', 'cacheHit', 'job'],
};
const short = (s) => s.replace(/^client:/, '');
const bytes = (b) => (b == null ? '—' : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const dur = (s) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);

export async function render(root, params) {
  if (state.user?.role !== 'admin') {
    root.append(h('div', { class: 'card' }, empty('🔒', 'Admins only', 'The first account created on this server is the admin. Others can be promoted from Users & reports, or with "npm run make-admin -- email".')));
    return undefined;
  }
  let tab = TABS.some(([k]) => k === params.tab) ? params.tab : 'overview';
  let timer = null;
  const charts = [];
  const D = {};
  const body = h('div', { class: 'cards-gap' });
  root.append(
    pageHeader({ title: 'Integration Monitor', subtitle: 'Health of every connected system, the data pipeline, and how TipidLitro is being used.', help: HELP,
      actions: [h('button', { class: 'btn small', type: 'button', onClick: () => refresh(true) }, icon('refresh'), 'Refresh')] }),
    tabBar(TABS, tab, (k) => { tab = k; setQuery({ tab: k === 'overview' ? null : k }); draw(); }),
    body);

  const chart = (canvas, cfg) => { const c = makeChart(canvas, cfg); charts.push(c); return c; };
  const canvasBox = (cls = 'chart-box tall') => { const c = h('canvas'); return [c, h('div', { class: cls }, c)]; };

  async function refresh(force = false) {
    try {
      const [stats, monitor, jobs, history, docs] = await Promise.all([api('/admin/stats'), api('/admin/monitor'), api('/admin/jobs'), api('/admin/history'), api('/admin/documents')]);
      Object.assign(D, { stats, monitor, jobs, history, docs });
      if (force || !D.drawn) draw();
      clearTimeout(timer);
      // Redraw automatically only while a job is running (or just finished), so the page doesn't jump while reading.
      timer = setTimeout(async () => {
        const wasRunning = D.jobs?.some((j) => j.running);
        await refresh();
        if ((wasRunning || D.jobs.some((j) => j.running)) && ['overview', 'data'].includes(tab) && !document.querySelector('.modal-back')) draw();
      }, jobs.some((j) => j.running) ? 5000 : 45000);
    } catch (e) { clear(body).append(alertBox('danger', e.message)); }
  }

  function draw() {
    D.drawn = true;
    charts.splice(0).forEach((c) => c.destroy());
    clear(body);
    if (!D.stats) { body.append(loading()); return; }
    ({ overview, integrations, data, usage, users, tools, system })[tab]();
  }

  // ======================================================== Overview
  function overview() {
    const s = D.stats; const ncr = s.data.freshness.find((f) => f.region === 'NCR');
    const okJobs = D.jobs.filter((j) => !j.manual && j.last?.status === 'success').length;
    const autoJobs = D.jobs.filter((j) => !j.manual).length;
    const doeCheck = D.jobs.find((j) => j.name === 'doe_latest')?.lastSuccess;
    body.append(h('div', { class: 'kpis' },
      kpi({ label: 'NCR prices', value: ncr?.latestWeek ? fmt.date(ncr.latestWeek, { month: 'short', day: 'numeric' }) : '—', sub: ncr?.ageDays != null ? `week start · ${ncr.ageDays} days ago` : 'no data yet', tone: ncr?.ageDays == null ? 'bad' : ncr.ageDays > 10 ? 'warn' : 'good', ico: 'fuel' }),
      kpi({ label: 'Last DOE check', value: doeCheck ? fmt.ago(doeCheck) : 'never', sub: 'automatic every hour', ico: 'refresh' }),
      kpi({ label: 'Integrations healthy', value: `${s.integrations.healthy} / ${s.integrations.total}`, sub: 'server-side sources in use', tone: s.integrations.healthy >= s.integrations.total - 1 ? 'good' : 'warn', ico: 'bolt' }),
      kpi({ label: 'Scheduled jobs OK', value: `${okJobs} / ${autoJobs}`, sub: 'last run succeeded', tone: okJobs === autoJobs ? 'good' : 'warn', ico: 'calendar' }),
      kpi({ label: 'Trips calculated', value: fmt.int(s.usage.tripTotals?.n || 0), sub: 'last 30 days', ico: 'route' }),
      kpi({ label: 'Assistant questions', value: fmt.int(s.usage.chatsDaily.reduce((a, d) => a + d.n, 0)), sub: 'last 30 days', ico: 'chat' }),
      kpi({ label: 'Users', value: fmt.int(s.usage.users?.n || 0), sub: `${s.usage.users?.new30 || 0} new · ${s.usage.activeUsers} signed in this week`, ico: 'user' }),
      kpi({ label: 'Price history', value: `${D.history.weeks} weeks`, sub: D.history.first ? `since ${fmt.date(D.history.first, { month: 'short', year: 'numeric' })}` : 'none yet', ico: 'trend' })));

    const att = s.attention;
    body.append(section({ title: att.some((a) => a.level !== 'info') ? 'Needs attention' : 'Notes', icon: 'alert', desc: att.length ? 'Things worth a look. Most "info" notes are optional improvements.' : null },
      att.length ? h('ul', { class: 'attention' }, att.map((a) => h('li', null, h('div', { class: `alert ${a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warn' : 'info'}` }, icon(a.level === 'info' ? 'info' : 'alert'),
        h('div', { style: { flex: 1 } }, a.text), a.tab ? h('button', { class: 'btn small ghost', type: 'button', onClick: () => goTab(a.tab) }, 'Open') : null))))
        : alertBox('ok', 'Everything looks good: data is fresh and all integrations are answering.')));

    const [callsCanvas, callsBox] = canvasBox(); const [tripsCanvas, tripsBox] = canvasBox();
    body.append(h('div', { class: 'charts-2' },
      section({ title: 'Outbound API calls · last 24 hours', icon: 'bolt', desc: 'Every request TipidLitro made to an outside system, per hour. Cached answers do not appear here.' }, callsBox),
      section({ title: 'Trips calculated · last 30 days', icon: 'route', desc: 'How many fuel-cost estimates people ran each day.' }, tripsBox)));
    // Hourly calls stacked by top sources
    const hours = [...Array(24)].map((_, i) => new Date(Date.now() - (23 - i) * 3600e3).toISOString().slice(0, 13).replace('T', ' '));
    const totals = new Map();
    for (const c of s.integrations.callsHourly) totals.set(c.source, (totals.get(c.source) || 0) + c.n);
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const series = [...top, 'other'];
    chart(callsCanvas, {
      type: 'bar',
      data: { labels: hours.map((x) => `${x.slice(11, 13)}:00`), datasets: series.map((src, i) => ({ label: src, backgroundColor: i < 6 ? SERIES_COLORS[i] : '#94a3b8', data: hours.map((hr) => s.integrations.callsHourly.filter((c) => c.hr === hr && (src === 'other' ? !top.includes(c.source) : c.source === src)).reduce((a, c) => a + c.n, 0)) })) },
      options: { scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 } }, y: { stacked: true, title: { display: true, text: 'calls (UTC hour)' } } } },
    });
    const days = [...Array(30)].map((_, i) => new Date(Date.now() - (29 - i) * 86400e3).toISOString().slice(0, 10));
    chart(tripsCanvas, {
      type: 'bar',
      data: { labels: days.map((d) => fmt.date(d, { month: 'short', day: 'numeric' })), datasets: [{ label: 'Trips', data: days.map((d) => s.usage.tripsDaily.find((x) => x.day === d)?.n || 0), backgroundColor: SERIES_COLORS[0], borderRadius: 4 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } },
    });
  }
  const goTab = (k) => { tab = k; setQuery({ tab: k }); document.querySelectorAll('.tabs [data-key]').forEach((b) => { b.classList.toggle('on', b.dataset.key === k); b.setAttribute('aria-selected', String(b.dataset.key === k)); }); draw(); };

  // ======================================================== Integrations
  function integrations() {
    const s = D.stats; const m = D.monitor;
    body.append(section({ title: 'What the colors mean', icon: 'info', desc: 'TipidLitro combines these outside systems. Each call is logged (time taken, success or error), and answers are cached to stay within free limits.' },
      h('div', { class: 'legend-row' }, ['healthy', 'degraded', 'down', 'idle', 'client', 'not_configured'].map((k) => h('span', null, h('span', { class: `status-dot st-${k}` }), h('b', null, STATUS_TEXT[k]), tip(STATUS_HELP[k]))))));

    const [latCanvas, latBox] = canvasBox(); const [okCanvas, okBox] = canvasBox(); const [dayCanvas, dayBox] = canvasBox();
    body.append(h('div', { class: 'charts-2' },
      section({ title: 'Response time · last 7 days', icon: 'bolt', desc: 'Typical (median) and slow (95th percentile) response in milliseconds. Shorter is better.' }, latBox),
      section({ title: 'Success rate · last 7 days', icon: 'info', desc: 'Share of calls that worked. GDELT often refuses extra requests (rate limit); other news sources cover for it.' }, okBox)));
    body.append(section({ title: 'Calls per day · last 14 days', icon: 'calendar', desc: 'Successful calls and errors per day. Spikes usually mean a history import or a busy day.' }, dayBox));
    const lat = s.integrations.latency.filter((x) => x.medianMs != null);
    chart(latCanvas, {
      type: 'bar',
      data: { labels: lat.map((x) => x.source), datasets: [{ label: 'Median ms', data: lat.map((x) => x.medianMs), backgroundColor: SERIES_COLORS[1], borderRadius: 4 }, { label: '95th percentile ms', data: lat.map((x) => x.p95Ms), backgroundColor: SERIES_COLORS[0], borderRadius: 4 }] },
      options: { indexAxis: 'y', scales: { x: { title: { display: true, text: 'milliseconds' } } } },
    });
    const all = s.integrations.latency;
    chart(okCanvas, {
      type: 'bar',
      data: { labels: all.map((x) => x.source), datasets: [{ label: 'Success %', data: all.map((x) => x.successRate), backgroundColor: all.map((x) => (x.successRate >= 90 ? '#16a34a' : x.successRate >= 50 ? '#d97706' : '#dc2626')), borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw}% of ${all[c.dataIndex].calls} calls` } } }, scales: { x: { min: 0, max: 100 } } },
    });
    const days = s.integrations.callsDaily;
    chart(dayCanvas, {
      type: 'bar',
      data: { labels: days.map((d) => fmt.date(d.day, { month: 'short', day: 'numeric' })), datasets: [{ label: 'Successful', data: days.map((d) => d.n - d.errors), backgroundColor: '#16a34a', borderRadius: 3 }, { label: 'Errors', data: days.map((d) => d.errors), backgroundColor: '#dc2626', borderRadius: 3 }] },
      options: { scales: { x: { stacked: true }, y: { stacked: true } } },
    });

    body.append(h('div', { class: 'mon' }, m.items.map((i) => h('div', { class: 'card', style: { cursor: i.client ? 'default' : 'pointer' }, title: i.client ? '' : 'Click for recent calls', onClick: () => { if (!i.client) integrationDetail(i); } },
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, h('span', { class: `status-dot st-${i.status}` }), h('b', { style: { flex: 1 } }, i.name), h('span', { class: 'badge gray' }, STATUS_TEXT[i.status])),
      h('div', { class: 'muted', style: { fontSize: '.8rem', margin: '4px 0 8px' } }, `${i.provider} · ${i.format}`),
      h('div', { style: { fontSize: '.84rem', marginBottom: '8px' } }, i.purpose),
      i.client ? null : h('dl', { class: 'kv' },
        h('dt', null, 'Calls (24 h)'), h('dd', null, `${i.calls24h}${i.errors24h ? ` · ${i.errors24h} failed` : ''}`),
        h('dt', null, 'Avg response'), h('dd', null, i.avgMs != null ? `${i.avgMs} ms` : '—'),
        h('dt', null, 'Success (7 d)'), h('dd', null, i.successRate7d != null ? `${i.successRate7d}%` : '—'),
        h('dt', null, 'Answered from cache'), h('dd', null, i.cacheHits + i.cacheMisses ? `${Math.round((i.cacheHits / (i.cacheHits + i.cacheMisses)) * 100)}% (${i.cacheHits})` : '—'),
        h('dt', null, 'Last success'), h('dd', null, i.lastSuccess ? fmt.ago(i.lastSuccess) : '—'),
        i.lastError ? [h('dt', null, 'Last error'), h('dd', { class: 'code', title: i.lastError.message }, `${fmt.ago(i.lastError.at)}: ${(i.lastError.message || '').slice(0, 80)}`)] : null),
      i.url ? h('a', { href: i.url, target: '_blank', rel: 'noopener', style: { fontSize: '.78rem' }, onClick: (e) => e.stopPropagation() }, 'Docs ', icon('external')) : null))));
  }

  async function integrationDetail(i) {
    const box = h('div', null, loading());
    modal(i.name, box, [{ label: 'Close', primary: true, value: true }]);
    let rows = [];
    try { rows = await api(`/admin/log?source=${encodeURIComponent(i.key)}&limit=40`); } catch (e) { clear(box).append(alertBox('danger', e.message)); return; }
    const canvas = h('canvas');
    clear(box).append(
      h('p', { class: 'muted', style: { marginTop: 0, fontSize: '.88rem' } }, i.purpose),
      rows.length ? h('div', { class: 'chart-box' }, canvas) : h('p', { class: 'muted' }, 'No calls logged in the last 14 days.'),
      rows.length ? h('div', { class: 'table-wrap', style: { marginTop: '10px', maxHeight: '260px', overflow: 'auto' } }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'HTTP'), h('th', null, 'ms'), h('th', { class: 'left' }, 'Result'))),
        h('tbody', null, rows.map((l) => h('tr', null, h('td', null, fmt.ago(l.created_at)), h('td', null, l.status_code ?? '—'), h('td', null, l.duration_ms), h('td', { class: 'left code', style: { whiteSpace: 'normal' } }, l.ok ? 'OK' : (l.error || 'failed').slice(0, 120))))))) : null);
    if (rows.length) {
      const rev = [...rows].reverse();
      charts.push(makeChart(canvas, {
        type: 'bar',
        data: { labels: rev.map((l) => fmt.ago(l.created_at)), datasets: [{ label: 'Response (ms)', data: rev.map((l) => l.duration_ms), backgroundColor: rev.map((l) => (l.ok ? SERIES_COLORS[1] : '#dc2626')), borderRadius: 3 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { display: false } } } },
      }));
    }
  }

  // ======================================================== Data & jobs
  function data() {
    const s = D.stats;
    body.append(section({ title: 'How fresh is the data?', icon: 'fuel', desc: 'DOE publishes NCR prices weekly (usually mid-week) and adjustment notices on Mondays. Regional reports come less regularly.' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Latest'), h('th', null, 'Age'), h('th', null, 'Weeks stored'), h('th', null, 'Imported'))),
        h('tbody', null,
          s.data.freshness.map((f) => h('tr', null, h('td', null, `${f.region} pump prices`), h('td', null, f.latestWeek ? fmt.date(f.latestWeek) : '—'),
            h('td', null, f.ageDays == null ? '—' : h('span', { class: `badge ${f.ageDays > 14 ? 'amber' : 'green'}` }, `${f.ageDays} d`)), h('td', null, fmt.int(f.weeks)), h('td', null, f.fetchedAt ? fmt.ago(f.fetchedAt) : '—'))),
          s.data.market.map((x) => h('tr', null, h('td', null, x.series === 'BRENT' ? 'Brent crude (daily)' : 'USD → PHP (daily)'), h('td', null, fmt.date(x.latest)), h('td', null, '—'), h('td', null, `${fmt.int(x.n)} days`), h('td', null, '—'))))))));

    const [covCanvas, covBox] = canvasBox(); const [jobCanvas, jobBox] = canvasBox();
    body.append(h('div', { class: 'charts-2' },
      section({ title: 'DOE reports by year', icon: 'calendar', desc: 'NCR weeks stored, plus reports that could not be read (usually scanned images).' }, covBox),
      section({ title: 'Job run times · last 7 days', icon: 'refresh', desc: 'Average seconds per run. Long runs are normal for history imports and the station sync.' }, jobBox)));
    const years = [...new Set([...s.data.coverage.map((c) => c.yr), ...s.data.docs.map((d) => d.yr)].filter(Boolean))].sort();
    chart(covCanvas, {
      type: 'bar',
      data: { labels: years, datasets: [
        { label: 'NCR weeks stored', data: years.map((y) => s.data.coverage.find((c) => c.yr === y)?.weeks || 0), backgroundColor: SERIES_COLORS[0], borderRadius: 4 },
        { label: 'Unreadable reports', data: years.map((y) => s.data.docs.filter((d) => d.yr === y && d.status === 'failed').reduce((a, d) => a + d.n, 0)), backgroundColor: '#94a3b8', borderRadius: 4 },
      ] },
    });
    chart(jobCanvas, {
      type: 'bar',
      data: { labels: s.jobs.map((j) => j.job), datasets: [{ label: 'Average seconds', data: s.jobs.map((j) => j.avgSec), backgroundColor: SERIES_COLORS[2], borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => `${s.jobs[c.dataIndex].runs} runs, ${s.jobs[c.dataIndex].failed} failed` } } } },
    });

    // History import
    const hist = D.history; const bj = D.jobs.find((j) => j.name === 'doe_backfill');
    const start = async (weeks) => { try { await api('/admin/history/import', { method: 'POST', body: { weeks } }); toast('History import started — it runs in the background'); setTimeout(() => refresh(true), 800); } catch (e) { toast(e.message, 'error'); } };
    body.append(section({ title: 'Price history import', icon: 'calendar', desc: `DOE's archive lists ${hist.availableReports ?? 'many'} weekly NCR reports back to 2017. They power the history charts, "this trip over the years", and the forecast. Reports already stored are skipped.` },
      h('p', { style: { margin: '0 0 10px' } }, hist.weeks ? [h('b', null, `${hist.weeks} weeks stored`), ` · ${fmt.date(hist.first)} → ${fmt.date(hist.last)}`] : 'No history yet.'),
      bj?.running ? h('div', { class: 'alert info' }, h('span', { class: 'spinner', style: { width: '16px', height: '16px', borderWidth: '2px' } }), h('div', null, bj.last?.message || 'Importing…'))
        : h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onClick: () => start(52) }, 'Last 1 year'),
          h('button', { class: 'btn', type: 'button', onClick: () => start(156) }, 'Last 3 years'),
          h('button', { class: 'btn primary', type: 'button', onClick: () => start('all') }, 'Everything since 2017'),
          bj?.last ? h('span', { class: 'faint', style: { fontSize: '.8rem' } }, `Last import ${fmt.ago(bj.last.started_at)}: ${(bj.last.message || bj.last.status).slice(0, 120)}`) : null)));

    // Jobs table
    body.append(section({ title: 'Scheduled jobs', icon: 'refresh', desc: 'Tasks the server runs on a timer to keep the database current. "Run now" starts one immediately.' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Job'), h('th', null, 'Every'), h('th', null, 'Last run'), h('th', null, 'Status'), h('th', { class: 'left' }, 'Result'), h('th', null, 'Next'), h('th', null, ''))),
        h('tbody', null, D.jobs.map((j) => h('tr', null,
          h('td', null, h('b', null, j.label), h('div', { class: 'faint code' }, j.name)), h('td', null, j.manual ? 'manual' : `${j.everyHours} h`),
          h('td', null, j.last ? fmt.ago(j.last.started_at) : 'never'),
          h('td', null, j.running ? h('span', { class: 'badge blue' }, 'running') : j.last ? h('span', { class: `badge ${j.last.status === 'success' ? 'green' : 'red'}` }, j.last.status) : '—'),
          h('td', { class: 'left code', style: { whiteSpace: 'normal', maxWidth: '380px' } }, j.last?.message || ''),
          h('td', null, j.manual ? '—' : j.nextDue ? (new Date(j.nextDue) > new Date() ? `in ${Math.max(1, Math.round((new Date(j.nextDue) - Date.now()) / 60000))} min` : 'due') : 'due'),
          h('td', null, j.manual ? null : h('button', { class: 'btn small', type: 'button', disabled: j.running, onClick: async () => { await api(`/admin/jobs/${j.name}/run`, { method: 'POST' }); toast(`${j.label}: started`); setTimeout(() => refresh(true), 800); } }, 'Run now')))))))));

    // News intake
    const [newsCanvas, newsBox] = canvasBox('chart-box');
    body.append(section({ title: 'News collected · last 14 days', icon: 'news', desc: 'New headlines stored per day, by source. Duplicates across sources are removed.', collapsible: true, open: false }, newsBox));
    const nd = [...new Set(s.data.news.map((n) => n.day))].sort(); const provs = [...new Set(s.data.news.map((n) => n.provider))];
    const det = newsCanvas.closest('details');
    det.addEventListener('toggle', () => { if (det.open && !newsCanvas.dataset.done) { newsCanvas.dataset.done = '1'; chart(newsCanvas, { type: 'bar', data: { labels: nd.map((d) => fmt.date(d, { month: 'short', day: 'numeric' })), datasets: provs.map((p, i) => ({ label: p, data: nd.map((d) => s.data.news.find((n) => n.day === d && n.provider === p)?.n || 0), backgroundColor: SERIES_COLORS[i] })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } }); } });

    // DOE documents
    const docs = D.docs;
    body.append(section({ title: `DOE documents processed (${docs.length})`, icon: 'news', desc: 'Every DOE PDF the importer has seen and what happened to it. "Re-import" downloads and reads it again.', collapsible: true, open: false },
      docs.length ? h('div', { class: 'table-wrap', style: { maxHeight: '420px', overflow: 'auto' } }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', { class: 'left' }, 'Report'), h('th', null, 'Kind'), h('th', null, 'Week'), h('th', null, 'Rows'), h('th', null, 'Status'), h('th', null, ''))),
        h('tbody', null, docs.map((d) => h('tr', null,
          h('td', { class: 'left', style: { whiteSpace: 'normal', maxWidth: '420px' } }, h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.title || d.url), d.message ? h('div', { class: 'faint code' }, d.message) : null),
          h('td', null, `${d.kind}${d.region ? ` · ${d.region}` : ''}`), h('td', null, d.week_start ? fmt.date(d.week_start) : '—'), h('td', null, d.rows_count),
          h('td', null, h('span', { class: `badge ${d.status === 'parsed' ? 'green' : d.status === 'retry' ? 'amber' : 'red'}` }, d.status === 'failed' ? 'unreadable' : d.status)),
          h('td', null, h('button', { class: 'btn small', type: 'button', onClick: async () => { await api(`/admin/documents/${d.id}/retry`, { method: 'POST' }); toast('Re-import started'); setTimeout(() => refresh(true), 1000); } }, 'Re-import'))))))) : h('p', { class: 'muted' }, 'None yet.')));
  }

  // ======================================================== Usage
  function usage() {
    const u = D.stats.usage; const t = u.tripTotals || {};
    const chats = u.chatsDaily.reduce((a, d) => a + d.n, 0);
    const gem = u.providers.filter((p) => String(p.provider).startsWith('gemini')).reduce((a, p) => a + p.n, 0);
    body.append(section({ title: 'About these numbers', icon: 'info', desc: 'Anonymous counts from the last 30 days. TipidLitro logs the vehicle type, region, distance and cost of each estimate — never locations or place names.' }));
    body.append(h('div', { class: 'kpis' },
      kpi({ label: 'Trips calculated', value: fmt.int(t.n || 0), sub: 'last 30 days', ico: 'route' }),
      kpi({ label: 'Average trip', value: t.avg_km ? `${fmt.num(t.avg_km)} km` : '—', sub: t.avg_cost ? `${fmt.peso(t.avg_cost)} average cost` : '', ico: 'fuel' }),
      kpi({ label: 'Round trips', value: t.n ? `${Math.round(((t.round_trips || 0) / t.n) * 100)}%` : '—', sub: 'of all estimates', ico: 'swap' }),
      kpi({ label: 'Fuel estimated', value: t.liters ? `${fmt.int(t.liters)} L` : '—', sub: 'total across all trips', ico: 'fuel' }),
      kpi({ label: 'Assistant questions', value: fmt.int(chats), sub: chats ? `${Math.round((gem / chats) * 100)}% answered with Gemini` : 'last 30 days', ico: 'chat' }),
      kpi({ label: 'Price alerts active', value: fmt.int(u.alerts.reduce((a, x) => a + x.n, 0)), sub: `${u.notifications?.n || 0} notifications sent (30 d)`, ico: 'bell' }),
      kpi({ label: 'Community price reports', value: fmt.int(u.reports), sub: 'last 14 days', ico: 'pin' })));

    const [tripsC, tripsB] = canvasBox(); const [catC, catB] = canvasBox(); const [vehC, vehB] = canvasBox(); const [regC, regB] = canvasBox(); const [intC, intB] = canvasBox(); const [chatC, chatB] = canvasBox();
    body.append(h('div', { class: 'charts-2' },
      section({ title: 'Trips per day', icon: 'route', desc: 'Estimates run each day, with the average trip cost.' }, tripsB),
      section({ title: 'Vehicle types', icon: 'car', desc: 'What people drive when they plan trips.' }, catB),
      section({ title: 'Most-used vehicles', icon: 'car' }, vehB),
      section({ title: 'Trips by region', icon: 'pin', desc: 'Based on where trips start.' }, regB),
      section({ title: 'What people ask the assistant', icon: 'chat', desc: 'Detected question type.' }, intB),
      section({ title: 'Assistant questions per day', icon: 'chat' }, chatB)));
    const days = [...Array(30)].map((_, i) => new Date(Date.now() - (29 - i) * 86400e3).toISOString().slice(0, 10));
    chart(tripsC, {
      type: 'bar',
      data: { labels: days.map((d) => fmt.date(d, { month: 'short', day: 'numeric' })), datasets: [
        { type: 'bar', label: 'Trips', data: days.map((d) => u.tripsDaily.find((x) => x.day === d)?.n || 0), backgroundColor: SERIES_COLORS[0], borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Avg cost ₱', data: days.map((d) => { const x = u.tripsDaily.find((y) => y.day === d); return x ? Math.round(x.avg_cost) : null; }), borderColor: SERIES_COLORS[1], pointRadius: 2, spanGaps: true, yAxisID: 'y1' },
      ] },
      options: { scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { position: 'left', title: { display: true, text: 'trips' } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '₱' } } } },
    });
    const pie = (canvas, rows, labelKey) => chart(canvas, { type: 'doughnut', data: { labels: rows.map((r) => r[labelKey] || 'unknown'), datasets: [{ data: rows.map((r) => r.n), backgroundColor: rows.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]), borderWidth: 0 }] }, options: { interaction: { mode: 'nearest' }, plugins: { legend: { position: 'right' } } } });
    const barH = (canvas, rows, labelKey, color) => chart(canvas, { type: 'bar', data: { labels: rows.map((r) => r[labelKey] || 'unknown'), datasets: [{ data: rows.map((r) => r.n), backgroundColor: color, borderRadius: 4 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
    if (u.categories.length) pie(catC, u.categories, 'category'); else catB.replaceWith(empty('🚗', 'No trips yet', ''));
    if (u.topVehicles.length) barH(vehC, u.topVehicles, 'name', SERIES_COLORS[2]); else vehB.replaceWith(empty('🏍️', 'No trips yet', ''));
    if (u.tripRegions.length) barH(regC, u.tripRegions, 'region', SERIES_COLORS[3]); else regB.replaceWith(empty('🗺️', 'No trips yet', ''));
    if (u.intents.length) barH(intC, u.intents.map((i) => ({ ...i, intent: i.intent.replace(/_/g, ' ') })), 'intent', SERIES_COLORS[1]); else intB.replaceWith(empty('💬', 'No questions yet', ''));
    chart(chatC, { type: 'line', data: { labels: days.map((d) => fmt.date(d, { month: 'short', day: 'numeric' })), datasets: [{ label: 'Questions', data: days.map((d) => u.chatsDaily.find((x) => x.day === d)?.n || 0), borderColor: SERIES_COLORS[1], backgroundColor: `${SERIES_COLORS[1]}33`, fill: true, pointRadius: 2, tension: 0.2 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } } });
  }

  // ======================================================== Users & reports
  async function users() {
    const box = h('div', { class: 'cards-gap' }, loading());
    body.append(box);
    let list; let reports;
    try { [list, reports] = await Promise.all([api('/admin/users'), api('/admin/reports')]); } catch (e) { clear(box).append(alertBox('danger', e.message)); return; }
    const alerts = D.stats.usage.alerts;
    clear(box).append(
      section({ title: `Users (${list.length})`, icon: 'user', desc: 'People with an account. Admins can open this monitor. There must always be at least one admin.' },
        list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', { class: 'left' }, 'Email'), h('th', null, 'Joined'), h('th', null, 'Last sign-in'), h('th', null, 'Vehicles'), h('th', null, 'Trips'), h('th', null, 'Fill-ups'), h('th', null, 'Alerts'), h('th', null, 'Role'))),
          h('tbody', null, list.map((u) => h('tr', null,
            h('td', null, u.name, u.id === state.user.id ? h('span', { class: 'faint' }, ' (you)') : null), h('td', { class: 'left' }, u.email), h('td', null, fmt.date(u.created_at)), h('td', null, u.last_login ? fmt.ago(u.last_login) : '—'),
            h('td', null, u.vehicles), h('td', null, u.trips), h('td', null, u.fill_ups), h('td', null, u.alerts),
            h('td', null, h('select', { style: { minHeight: '32px', padding: '4px 8px', width: 'auto' }, onChange: async (e) => {
              try { await api(`/admin/users/${u.id}/role`, { method: 'PUT', body: { role: e.target.value } }); toast(`${u.name} is now ${e.target.value === 'admin' ? 'an admin' : 'a regular user'}`); } catch (err) { toast(err.message, 'error'); e.target.value = u.role; }
            } }, ['user', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r)))))))))
          : h('p', { class: 'muted' }, 'No users yet.')),
      section({ title: 'Active price alerts', icon: 'bell', desc: 'What people asked to be notified about.' },
        alerts.length ? h('div', { class: 'kpis', style: { marginBottom: 0 } }, alerts.map((a) => kpi({ label: { below: 'Price drops below', above: 'Price rises above', adjustment: 'Every adjustment', rollback: 'Rollback expected' }[a.kind] || a.kind, value: fmt.int(a.n) }))) : h('p', { class: 'muted', style: { margin: 0 } }, 'No alerts set yet.')),
      section({ title: `Community price reports (${reports.length})`, icon: 'pin', desc: 'Prices users reported at stations. They show on the Stations page for 14 days. Remove anything that looks wrong or abusive.' },
        reports.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'When'), h('th', { class: 'left' }, 'Station'), h('th', null, 'Fuel'), h('th', null, 'Price'), h('th', { class: 'left' }, 'Note'), h('th', { class: 'left' }, 'By'), h('th', null, ''))),
          h('tbody', null, reports.map((r) => h('tr', null, h('td', null, fmt.ago(r.reported_at)), h('td', { class: 'left' }, `${r.station || r.station_osm_id}${r.brand ? ` (${r.brand})` : ''}`), h('td', null, r.product), h('td', null, fmt.peso(r.price)), h('td', { class: 'left', style: { whiteSpace: 'normal' } }, r.note || ''), h('td', { class: 'left' }, r.email || '—'),
            h('td', null, h('button', { class: 'btn small ghost danger', type: 'button', title: 'Remove report', onClick: async () => { await api(`/admin/reports/${r.id}`, { method: 'DELETE' }); toast('Report removed'); draw(); } }, icon('trash')))))))) : h('p', { class: 'muted', style: { margin: 0 } }, 'No reports yet.')));
  }

  // ======================================================== Tools
  function tools() {
    const region = h('select', null, REGIONS.map((r) => h('option', { value: r }, r)));
    const product = h('select', null, ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'].map((p) => h('option', { value: p }, p)));
    const week = h('input', { type: 'date' });
    const common = h('input', { type: 'number', step: '0.01', placeholder: 'e.g. 81.70' });
    const min = h('input', { type: 'number', step: '0.01', placeholder: 'optional' });
    const max = h('input', { type: 'number', step: '0.01', placeholder: 'optional' });
    const csv = h('textarea', { placeholder: 'region,area,brand,product,min,max,common,week_start\nVisayas,ALL,ALL,RON91,84.10,92.50,88.20,2026-10-20' });
    body.append(
      section({ title: 'Enter a price by hand', icon: 'plus', desc: 'For a week whose DOE report could not be read (scanned or new layout). Manual prices are labelled as such wherever they appear.' },
        h('div', { class: 'grid cols-3', style: { gap: '10px' } },
          h('div', { class: 'field' }, h('label', null, 'Region'), region), h('div', { class: 'field' }, h('label', null, 'Fuel'), product), h('div', { class: 'field' }, h('label', null, 'Week start (a Tuesday)'), week),
          h('div', { class: 'field' }, h('label', null, term('common')), common), h('div', { class: 'field' }, h('label', null, 'Lowest price'), min), h('div', { class: 'field' }, h('label', null, 'Highest price'), max)),
        h('button', { class: 'btn primary', type: 'button', onClick: async () => {
          try { await api('/admin/prices', { method: 'POST', body: { entries: [{ region: region.value, product: product.value, weekStart: week.value, common: Number(common.value), min: Number(min.value) || null, max: Number(max.value) || null }] } }); toast('Price saved'); } catch (e) { toast(e.message, 'error'); }
        } }, 'Save price')),
      section({ title: 'Import many prices (CSV)', icon: 'download', desc: 'Paste rows with these columns: region, area, brand, product, min, max, common, week_start. Use ALL for area and brand for region-wide prices.' },
        h('div', { class: 'field' }, csv),
        h('button', { class: 'btn', type: 'button', onClick: async () => {
          try { const r = await api('/admin/prices/csv', { method: 'POST', body: { csv: csv.value } }); toast(`Imported ${r.saved} rows${r.skippedLines.length ? `, skipped lines ${r.skippedLines.join(', ')}` : ''}`); } catch (e) { toast(e.message, 'error'); }
        } }, 'Import CSV')),
      section({ title: 'Cache', icon: 'refresh', desc: `TipidLitro keeps copies of answers from outside services (routes, places, weather…) to stay fast and within free limits. ${fmt.int(D.monitor.counts.cache_rows)} entries stored. Clearing forces fresh calls.` },
        h('button', { class: 'btn', type: 'button', onClick: async () => { await api('/admin/cache/clear', { method: 'POST', body: {} }); toast('Cache cleared'); } }, 'Clear all cached answers')));
  }

  // ======================================================== System
  async function system() {
    const s = D.stats; const sys = s.system;
    const kv = (rows) => h('dl', { class: 'kv', style: { fontSize: '.88rem', gap: '6px 16px' } }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
    const yes = (b, extra = '') => h('span', { class: `badge ${b ? 'green' : 'gray'}` }, b ? `set${extra}` : 'not set');
    const [tblC, tblB] = canvasBox();
    body.append(h('div', { class: 'charts-2' },
      section({ title: 'Server', icon: 'gear' }, kv([
        ['TipidLitro', `v${sys.version}`], ['Node.js', sys.node], ['Operating system', sys.platform], ['CPU cores', sys.cpus],
        ['Running for', dur(sys.uptimeSec)], ['Memory used', `${sys.memoryMb} MB (heap ${sys.heapMb} MB)`], ['Free system memory', `${fmt.int(sys.freeMemMb)} MB`],
        ['Today in Manila', fmt.date(sys.manilaDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })],
      ])),
      section({ title: 'Database', icon: 'save' }, kv([
        ['Engine', sys.database], ['Size on disk', bytes(sys.dbBytes)], ['Scheduler', sys.scheduler ? 'on (automatic sync)' : 'off'],
        ['Total rows', fmt.int(s.tables.reduce((a, t) => a + t.rows, 0))], ['Switch engines', 'Set DB_CLIENT=sqlite or mysql in .env and restart'],
      ]))));
    body.append(h('div', { class: 'charts-2' },
      section({ title: 'API keys and settings', icon: 'gear', desc: 'Read from .env when the server starts. Keys are never shown. Edit .env and restart to change them.' }, kv([
        ['Gemini (assistant)', yes(sys.keys.gemini, ` · ${sys.settings.geminiModel}`)], ['EIA (Brent)', yes(sys.keys.eia)], ['FRED (Brent)', yes(sys.keys.fred, '')],
        ['GNews', yes(sys.keys.gnews)], ['NewsData.io', yes(sys.keys.newsdata)], ['Contact email (OSM)', yes(sys.keys.contactEmail)],
        ['DOE weeks checked hourly', sys.settings.doeBackfillWeeks], ['EV electricity rate', `₱${sys.settings.electricityRate}/kWh`], ['Routing server', sys.settings.osrmUrl],
      ])),
      section({ title: 'Rows per table', icon: 'trend', desc: 'Where the data lives. fuel_prices holds every DOE price since 2017.' }, tblB)));
    const tables = [...s.tables].sort((a, b) => b.rows - a.rows);
    chart(tblC, { type: 'bar', data: { labels: tables.map((t) => t.table), datasets: [{ data: tables.map((t) => t.rows), backgroundColor: SERIES_COLORS[0], borderRadius: 3 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { type: 'logarithmic', title: { display: true, text: 'rows (log scale)' } } } } });

    const logBox = h('div', null, loading());
    body.append(section({ title: 'Recent outbound calls', icon: 'bolt', desc: 'The last 60 requests to outside systems. API keys are hidden.', collapsible: true, open: false }, logBox));
    try {
      const log = await api('/admin/log?limit=60');
      clear(logBox).append(h('div', { class: 'table-wrap', style: { maxHeight: '420px', overflow: 'auto' } }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Source'), h('th', { class: 'left' }, 'Endpoint'), h('th', null, 'HTTP'), h('th', null, 'ms'))),
        h('tbody', null, log.map((l) => h('tr', null, h('td', null, fmt.ago(l.created_at)), h('td', null, h('span', { class: `status-dot ${l.ok ? 'st-healthy' : 'st-down'}`, style: { marginRight: '6px' } }), short(l.source)),
          h('td', { class: 'left code', style: { whiteSpace: 'normal', maxWidth: '520px' }, title: l.error || '' }, l.endpoint, l.error ? h('div', { class: 'up' }, l.error.slice(0, 160)) : null),
          h('td', null, l.status_code ?? '—'), h('td', null, l.duration_ms)))))));
    } catch (e) { clear(logBox).append(alertBox('danger', e.message)); }
  }

  body.append(loading('Loading the dashboard…'));
  await refresh(true);
  return () => { clearTimeout(timer); charts.forEach((c) => c.destroy()); };
}
