// Integration Monitor for admins (port of public/js/views/admin.js): overview, integrations,
// data & jobs, usage, users & reports, tools and system — with charts and plain explanations.
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { BarChart, Donut, HBarChart, LineChart } from '../components/charts';
import {
  AlertBox, Badge, Btn, Card, Empty, Field, Icon, IconButton, Input, Kpi, KpiGrid, Loading, PageHeader, Row, Screen, Section, Seg, Select, Sheet, Table, Tabs, Tip, Txt, toast,
} from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { fmt, REGIONS } from '../lib/format';
import { SERIES, useTheme } from '../lib/theme';

const STATUS_TEXT = { healthy: 'Healthy', degraded: 'Some errors', down: 'Failing', idle: 'No calls yet', client: 'Runs on the device', not_configured: 'No API key' };
const STATUS_HELP = {
  healthy: 'Answering normally.', degraded: 'Working, but some recent calls failed.', down: 'The most recent calls failed. Features using it fall back or show an error.',
  idle: 'Not called yet (it is only used when someone needs it).', client: 'Used directly by the visitor\'s browser or phone, so the server cannot measure it.', not_configured: 'Optional; needs an API key in .env.',
};
const TABS = [['overview', 'Overview'], ['integrations', 'Integrations'], ['data', 'Data & jobs'], ['usage', 'Usage'], ['users', 'Users & reports'], ['tools', 'Tools'], ['system', 'System']];
const short = (s) => s.replace(/^client:/, '');
const bytes = (b) => (b == null ? '—' : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const dur = (s) => (s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);
const last30 = () => [...Array(30)].map((_, i) => new Date(Date.now() - (29 - i) * 86400e3).toISOString().slice(0, 10));

function useStatusColors() {
  const t = useTheme();
  return { healthy: t.green, degraded: t.amber, down: t.red, idle: t.faint, client: t.blue, not_configured: t.faint };
}
function Dot({ status }) { const c = useStatusColors(); return <View style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: c[status] || '#94a3b8' }} />; }
function KV({ rows }) {
  const t = useTheme();
  return rows.map(([k, v]) => (
    <Row key={k} between align="flex-start" style={{ borderBottomWidth: 1, borderColor: t.border, paddingVertical: 5 }}>
      <Txt variant="small" tone="muted" style={{ flex: 1 }}>{k}</Txt>
      {typeof v === 'string' || typeof v === 'number' ? <Txt variant="small" style={{ flex: 1.3, textAlign: 'right' }}>{v}</Txt> : <View style={{ flex: 1.3, alignItems: 'flex-end' }}>{v}</View>}
    </Row>
  ));
}

export default function Admin() {
  const { user } = useApp();
  const [tab, setTab] = useState('overview');
  const [D, setD] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const refreshRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [stats, monitor, jobs, history, docs] = await Promise.all([api('/admin/stats'), api('/admin/monitor'), api('/admin/jobs'), api('/admin/history'), api('/admin/documents')]);
      setD({ stats, monitor, jobs, history, docs }); setError(null);
      clearTimeout(timer.current);
      // Poll faster while a job runs, so progress shows without pulling to refresh.
      timer.current = setTimeout(() => refreshRef.current(), jobs.some((j) => j.running) ? 5000 : 45000);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { if (user?.role === 'admin') refresh(); return () => clearTimeout(timer.current); }, [user, refresh]);

  if (user?.role !== 'admin') {
    return <Screen><PageHeader back title="Admin" /><Card><Empty icon="🔒" title="Admins only" text={'The first account created on the server is the admin. Others can be promoted from Users & reports, or with "npm run make-admin -- email".'} /></Card></Screen>;
  }
  const props = { D, refresh, goTab: setTab };
  return (
    <Screen onRefresh={refresh} refreshing={false}>
      <PageHeader back title="Integration Monitor" help="admin" subtitle="Health of every connected system, the data pipeline, and how TipidLitro is being used." actions={<IconButton icon="refresh" label="Refresh" onPress={refresh} />} />
      <Tabs items={TABS} value={tab} onChange={setTab} />
      {error ? <AlertBox level="danger" text={error} /> : null}
      {!D ? <Loading text="Loading the dashboard…" /> : tab === 'overview' ? <Overview {...props} /> : tab === 'integrations' ? <Integrations {...props} /> : tab === 'data' ? <DataJobs {...props} />
        : tab === 'usage' ? <Usage {...props} /> : tab === 'users' ? <Users {...props} /> : tab === 'tools' ? <Tools {...props} /> : <System {...props} />}
    </Screen>
  );
}

// ======================================================== Overview
function Overview({ D, goTab }) {
  const t = useTheme();
  const s = D.stats; const ncr = s.data.freshness.find((f) => f.region === 'NCR');
  const okJobs = D.jobs.filter((j) => !j.manual && j.last?.status === 'success').length;
  const autoJobs = D.jobs.filter((j) => !j.manual).length;
  const doeCheck = D.jobs.find((j) => j.name === 'doe_latest')?.lastSuccess;
  const att = s.attention;
  const hours = [...Array(24)].map((_, i) => new Date(Date.now() - (23 - i) * 3600e3).toISOString().slice(0, 13).replace('T', ' '));
  const totals = new Map();
  for (const c of s.integrations.callsHourly) totals.set(c.source, (totals.get(c.source) || 0) + c.n);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const days = last30();
  return (
    <>
      <KpiGrid>
        <Kpi icon="fuel" label="NCR prices" value={ncr?.latestWeek ? fmt.date(ncr.latestWeek, { year: false }) : '—'} sub={ncr?.ageDays != null ? `week start · ${ncr.ageDays} days ago` : 'no data yet'} tone={ncr?.ageDays == null ? 'bad' : ncr.ageDays > 10 ? 'warn' : 'good'} />
        <Kpi icon="refresh" label="Last DOE check" value={doeCheck ? fmt.ago(doeCheck) : 'never'} sub="automatic every hour" />
        <Kpi icon="bolt" label="Integrations healthy" value={`${s.integrations.healthy} / ${s.integrations.total}`} sub="server-side sources in use" tone={s.integrations.healthy >= s.integrations.total - 1 ? 'good' : 'warn'} tip="Outside systems TipidLitro calls: DOE, maps, weather, news…" />
        <Kpi icon="calendar" label="Scheduled jobs OK" value={`${okJobs} / ${autoJobs}`} sub="last run succeeded" tone={okJobs === autoJobs ? 'good' : 'warn'} />
        <Kpi icon="route" label="Trips calculated" value={fmt.int(s.usage.tripTotals?.n || 0)} sub="last 30 days" />
        <Kpi icon="chat" label="Assistant questions" value={fmt.int(s.usage.chatsDaily.reduce((a, d) => a + d.n, 0))} sub="last 30 days" />
        <Kpi icon="user" label="Users" value={fmt.int(s.usage.users?.n || 0)} sub={`${s.usage.users?.new30 || 0} new · ${s.usage.activeUsers} this week`} />
        <Kpi icon="trend" label="Price history" value={`${D.history.weeks} weeks`} sub={D.history.first ? `since ${fmt.date(D.history.first, { day: false })}` : 'none yet'} />
      </KpiGrid>
      <Section title={att.some((a) => a.level !== 'info') ? 'Needs attention' : 'Notes'} icon="alert" desc={att.length ? 'Things worth a look. Most "info" notes are optional improvements.' : null}>
        {att.length ? att.map((a, i) => <AlertBox key={i} level={a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warn' : 'info'} text={a.text} action={a.tab ? <Btn small variant="ghost" title="Open" onPress={() => goTab(a.tab)} /> : null} />)
          : <AlertBox level="ok" text="Everything looks good: data is fresh and all integrations are answering." />}
      </Section>
      <Section title="Outbound API calls · last 24 hours" icon="bolt" desc="Every request to an outside system, per hour (UTC). Cached answers do not appear here.">
        <BarChart stacked height={200} labels={hours.map((x) => `${x.slice(11, 13)}h`)}
          series={[...top, 'other'].map((src, i) => ({ label: src, color: i < top.length ? SERIES[i] : '#94a3b8', data: hours.map((hr) => s.integrations.callsHourly.filter((c) => c.hr === hr && (src === 'other' ? !top.includes(c.source) : c.source === src)).reduce((a, c) => a + c.n, 0)) }))}
          yFormat={(v) => String(Math.round(v))} valueFormat={(v) => `${v} calls`} />
      </Section>
      <Section title="Trips calculated · last 30 days" icon="route" desc="How many fuel-cost estimates people ran each day.">
        <BarChart height={180} labels={days.map((d) => fmt.date(d, { year: false }))} series={[{ label: 'Trips', color: t.brand, data: days.map((d) => s.usage.tripsDaily.find((x) => x.day === d)?.n || 0) }]} yFormat={(v) => String(Math.round(v))} />
      </Section>
    </>
  );
}

// ======================================================== Integrations
function Integrations({ D }) {
  const t = useTheme();
  const colors = useStatusColors();
  const [detail, setDetail] = useState(null);
  const s = D.stats; const m = D.monitor;
  const lat = s.integrations.latency.filter((x) => x.medianMs != null);
  const days = s.integrations.callsDaily;
  return (
    <>
      <Section title="What the colors mean" icon="info" desc="Each call is logged (time taken, success or error), and answers are cached to stay within free limits.">
        <Row wrap gap={12}>{Object.keys(STATUS_TEXT).map((k) => <Row key={k} gap={5}><Dot status={k} /><Txt variant="small" bold>{STATUS_TEXT[k]}</Txt><Tip text={STATUS_HELP[k]} /></Row>)}</Row>
      </Section>
      <Section title="Response time · last 7 days" icon="bolt" desc="Typical (median) response in milliseconds. Shorter is better.">
        <HBarChart items={lat.map((x) => ({ label: x.source, value: x.medianMs, display: `${x.medianMs} ms · p95 ${x.p95Ms} ms` }))} color={SERIES[1]} />
      </Section>
      <Section title="Success rate · last 7 days" icon="info" desc="Share of calls that worked. GDELT often refuses extra requests (rate limit); other news sources cover for it.">
        <HBarChart items={s.integrations.latency.map((x) => ({ label: x.source, value: x.successRate, color: x.successRate >= 90 ? t.green : x.successRate >= 50 ? t.amber : t.red, display: `${x.successRate}% of ${x.calls}` }))} />
      </Section>
      <Section title="Calls per day · last 14 days" icon="calendar" desc="Successful calls and errors per day.">
        <BarChart stacked height={180} labels={days.map((d) => fmt.date(d.day, { year: false }))} series={[{ label: 'Successful', color: '#16a34a', data: days.map((d) => d.n - d.errors) }, { label: 'Errors', color: '#dc2626', data: days.map((d) => d.errors) }]} yFormat={(v) => String(Math.round(v))} />
      </Section>
      {m.items.map((i) => (
        <Card key={i.key || i.name} onPress={i.client ? undefined : () => setDetail(i)}>
          <Row gap={8}><Dot status={i.status} /><Txt bold style={{ flex: 1 }}>{i.name}</Txt><Badge label={STATUS_TEXT[i.status]} tone={{ healthy: 'green', degraded: 'amber', down: 'red', client: 'blue' }[i.status] || 'gray'} /></Row>
          <Txt variant="tiny" tone="muted">{i.provider} · {i.format}</Txt>
          <Txt variant="small">{i.purpose}</Txt>
          {i.client ? null : (
            <KV rows={[
              ['Calls (24 h)', `${i.calls24h}${i.errors24h ? ` · ${i.errors24h} failed` : ''}`], ['Avg response', i.avgMs != null ? `${i.avgMs} ms` : '—'],
              ['Success (7 d)', i.successRate7d != null ? `${i.successRate7d}%` : '—'],
              ['Answered from cache', i.cacheHits + i.cacheMisses ? `${Math.round((i.cacheHits / (i.cacheHits + i.cacheMisses)) * 100)}% (${i.cacheHits})` : '—'],
              ['Last success', i.lastSuccess ? fmt.ago(i.lastSuccess) : '—'],
              ...(i.lastError ? [['Last error', `${fmt.ago(i.lastError.at)}: ${(i.lastError.message || '').slice(0, 80)}`]] : []),
            ]} />
          )}
          <Row gap={6}>
            {!i.client ? <Txt variant="tiny" tone="brand" bold>Tap for recent calls</Txt> : null}
            {i.url ? <Pressable onPress={() => WebBrowser.openBrowserAsync(i.url)}><Txt variant="tiny" tone="muted" style={{ textDecorationLine: 'underline' }}>Docs</Txt></Pressable> : null}
          </Row>
          <View style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 3, backgroundColor: colors[i.status] || t.faint }} />
        </Card>
      ))}
      <IntegrationSheet item={detail} onClose={() => setDetail(null)} />
    </>
  );
}
function IntegrationSheet({ item, onClose }) {
  const t = useTheme();
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); if (item) api(`/admin/log?source=${encodeURIComponent(item.key)}&limit=40`).then(setRows).catch((e) => setRows({ error: e.message })); }, [item]);
  const rev = Array.isArray(rows) ? [...rows].reverse() : [];
  return (
    <Sheet visible={Boolean(item)} onClose={onClose} title={item?.name || ''}>
      {item ? <Txt variant="small" tone="muted">{item.purpose}</Txt> : null}
      {!rows ? <Loading /> : rows.error ? <AlertBox level="danger" text={rows.error} /> : !rows.length ? <Txt tone="muted">No calls logged in the last 14 days.</Txt> : (
        <>
          <BarChart height={160} labels={rev.map((l) => fmt.ago(l.created_at))} series={[{ label: 'Response (ms)', color: SERIES[1], data: rev.map((l) => l.duration_ms) }]} barColors={rev.map((l) => (l.ok ? SERIES[1] : '#dc2626'))} yFormat={(v) => `${Math.round(v)}`} valueFormat={(v) => `${v} ms`} />
          {rows.map((l) => (
            <View key={l.id} style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 6 }}>
              <Row between><Txt variant="small" bold>{fmt.ago(l.created_at)}</Txt><Txt variant="small" tone="muted">HTTP {l.status_code ?? '—'} · {l.duration_ms} ms</Txt></Row>
              <Txt variant="tiny" tone={l.ok ? 'green' : 'red'}>{l.ok ? 'OK' : (l.error || 'failed').slice(0, 140)}</Txt>
            </View>
          ))}
        </>
      )}
    </Sheet>
  );
}

// ======================================================== Data & jobs
function DataJobs({ D, refresh }) {
  const t = useTheme();
  const [showDocs, setShowDocs] = useState(false);
  const s = D.stats; const hist = D.history; const bj = D.jobs.find((j) => j.name === 'doe_backfill');
  const years = [...new Set([...s.data.coverage.map((c) => c.yr), ...s.data.docs.map((d) => d.yr)].filter(Boolean))].sort();
  const nd = [...new Set(s.data.news.map((n) => n.day))].sort(); const provs = [...new Set(s.data.news.map((n) => n.provider))];
  const start = async (weeks) => { try { await api('/admin/history/import', { method: 'POST', body: { weeks } }); toast('History import started — it runs in the background'); setTimeout(refresh, 800); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <Section title="How fresh is the data?" icon="fuel" desc="DOE publishes NCR prices weekly and adjustment notices on Mondays. Regional reports come less regularly.">
        <Table columns={[
          { key: 'name', label: 'Data', align: 'left', width: 150, render: (r) => <Txt variant="small">{r.name}</Txt> },
          { key: 'latest', label: 'Latest', width: 100 },
          { key: 'age', label: 'Age', width: 64, render: (r) => (r.age == null ? <Txt variant="small" tone="faint">—</Txt> : <Badge label={`${r.age} d`} tone={r.age > 14 ? 'amber' : 'green'} />) },
          { key: 'stored', label: 'Stored', width: 84 }, { key: 'imported', label: 'Imported', width: 90 },
        ]} rows={[
          ...s.data.freshness.map((f) => ({ name: `${f.region} pump prices`, latest: f.latestWeek ? fmt.date(f.latestWeek) : '—', age: f.ageDays, stored: `${fmt.int(f.weeks)} wk`, imported: f.fetchedAt ? fmt.ago(f.fetchedAt) : '—' })),
          ...s.data.market.map((x) => ({ name: x.series === 'BRENT' ? 'Brent crude (daily)' : 'USD → PHP (daily)', latest: fmt.date(x.latest), age: null, stored: `${fmt.int(x.n)} d`, imported: '—' })),
        ]} />
      </Section>
      <Section title="DOE reports by year" icon="calendar" desc="NCR weeks stored, plus reports that could not be read (usually scanned images).">
        <BarChart height={190} labels={years.map(String)} series={[
          { label: 'NCR weeks stored', color: SERIES[0], data: years.map((y) => s.data.coverage.find((c) => c.yr === y)?.weeks || 0) },
          { label: 'Unreadable reports', color: '#94a3b8', data: years.map((y) => s.data.docs.filter((d) => d.yr === y && d.status === 'failed').reduce((a, d) => a + d.n, 0)) },
        ]} yFormat={(v) => String(Math.round(v))} />
      </Section>
      <Section title="Job run times · last 7 days" icon="refresh" desc="Average seconds per run. Long runs are normal for history imports and the station sync.">
        <HBarChart items={s.jobs.map((j) => ({ label: j.job, value: j.avgSec, display: `${fmt.num(j.avgSec, 1)} s · ${j.runs} runs${j.failed ? `, ${j.failed} failed` : ''}` }))} color={SERIES[2]} />
      </Section>
      <Section title="Price history import" icon="calendar" desc={`DOE's archive lists ${hist.availableReports ?? 'many'} weekly NCR reports back to 2017. Reports already stored are skipped.`}>
        <Txt>{hist.weeks ? <><Txt bold>{hist.weeks} weeks stored</Txt> · {fmt.date(hist.first)} → {fmt.date(hist.last)}</> : 'No history yet.'}</Txt>
        {bj?.running ? <AlertBox level="info" text={bj.last?.message || 'Importing…'} /> : (
          <>
            <Row wrap gap={6}><Btn small title="Last 1 year" onPress={() => start(52)} /><Btn small title="Last 3 years" onPress={() => start(156)} /><Btn small variant="primary" title="Everything since 2017" onPress={() => start('all')} /></Row>
            {bj?.last ? <Txt variant="tiny" tone="faint">Last import {fmt.ago(bj.last.started_at)}: {(bj.last.message || bj.last.status).slice(0, 120)}</Txt> : null}
          </>
        )}
      </Section>
      <Section title="Scheduled jobs" icon="refresh" desc={'Tasks the server runs on a timer to keep the database current. "Run now" starts one immediately.'}>
        {D.jobs.map((j) => (
          <View key={j.name} style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 8, gap: 3 }}>
            <Row between>
              <View style={{ flex: 1 }}><Txt bold>{j.label}</Txt><Txt variant="tiny" tone="faint">{j.name} · {j.manual ? 'manual' : `every ${j.everyHours} h`} · last {j.last ? fmt.ago(j.last.started_at) : 'never'}{!j.manual ? ` · next ${j.nextDue && new Date(j.nextDue) > new Date() ? `in ${Math.max(1, Math.round((new Date(j.nextDue) - Date.now()) / 60000))} min` : 'due'}` : ''}</Txt></View>
              {j.running ? <Badge label="running" tone="blue" /> : j.last ? <Badge label={j.last.status} tone={j.last.status === 'success' ? 'green' : 'red'} /> : null}
            </Row>
            {j.last?.message ? <Txt variant="tiny" tone="muted" numberOfLines={3}>{j.last.message}</Txt> : null}
            {!j.manual ? <Btn small title="Run now" disabled={j.running} onPress={async () => { try { await api(`/admin/jobs/${j.name}/run`, { method: 'POST' }); toast(`${j.label}: started`); setTimeout(refresh, 800); } catch (e) { toast(e.message, 'error'); } }} /> : null}
          </View>
        ))}
      </Section>
      <Section title="News collected · last 14 days" icon="news" desc="New headlines stored per day, by source. Duplicates across sources are removed." collapsible defaultOpen={false}>
        {nd.length ? <BarChart stacked height={190} labels={nd.map((d) => fmt.date(d, { year: false }))} series={provs.map((p, i) => ({ label: p, color: SERIES[i % SERIES.length], data: nd.map((d) => s.data.news.find((n) => n.day === d && n.provider === p)?.n || 0) }))} yFormat={(v) => String(Math.round(v))} /> : <Txt tone="muted">No headlines yet.</Txt>}
      </Section>
      <Section title={`DOE documents processed (${D.docs.length})`} icon="news" desc={'Every DOE PDF the importer has seen and what happened to it. "Re-import" downloads and reads it again.'} collapsible defaultOpen={false}>
        {(showDocs ? D.docs : D.docs.slice(0, 25)).map((d) => (
          <View key={d.id} style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 6, gap: 2 }}>
            <Pressable onPress={() => WebBrowser.openBrowserAsync(d.url)}><Txt variant="small" bold numberOfLines={2}>{d.title || d.url}</Txt></Pressable>
            <Row between>
              <Txt variant="tiny" tone="muted" style={{ flex: 1 }}>{d.kind}{d.region ? ` · ${d.region}` : ''} · {d.week_start ? fmt.date(d.week_start) : '—'} · {d.rows_count} rows</Txt>
              <Badge label={d.status === 'failed' ? 'unreadable' : d.status} tone={d.status === 'parsed' ? 'green' : d.status === 'retry' ? 'amber' : 'red'} />
            </Row>
            {d.message ? <Txt variant="tiny" tone="faint" numberOfLines={2}>{d.message}</Txt> : null}
            <Btn small title="Re-import" onPress={async () => { try { await api(`/admin/documents/${d.id}/retry`, { method: 'POST' }); toast('Re-import started'); setTimeout(refresh, 1000); } catch (e) { toast(e.message, 'error'); } }} />
          </View>
        ))}
        {D.docs.length > 25 && !showDocs ? <Btn small title={`Show all ${D.docs.length}`} onPress={() => setShowDocs(true)} /> : null}
      </Section>
    </>
  );
}

// ======================================================== Usage
function Usage({ D }) {
  const u = D.stats.usage; const tt = u.tripTotals || {};
  const chats = u.chatsDaily.reduce((a, d) => a + d.n, 0);
  const gem = u.providers.filter((p) => String(p.provider).startsWith('gemini')).reduce((a, p) => a + p.n, 0);
  const days = last30();
  const items = (rows, key, color) => rows.map((r, i) => ({ label: r[key] || 'unknown', value: r.n, color: color || SERIES[i % SERIES.length] }));
  return (
    <>
      <AlertBox level="info" text="Anonymous counts from the last 30 days. TipidLitro logs the vehicle type, region, distance and cost of each estimate — never locations or place names." />
      <KpiGrid>
        <Kpi icon="route" label="Trips calculated" value={fmt.int(tt.n || 0)} sub="last 30 days" />
        <Kpi icon="fuel" label="Average trip" value={tt.avg_km ? `${fmt.num(tt.avg_km)} km` : '—'} sub={tt.avg_cost ? `${fmt.peso(tt.avg_cost)} average cost` : ''} />
        <Kpi icon="swap" label="Round trips" value={tt.n ? `${Math.round(((tt.round_trips || 0) / tt.n) * 100)}%` : '—'} sub="of all estimates" />
        <Kpi icon="drop" label="Fuel estimated" value={tt.liters ? `${fmt.int(tt.liters)} L` : '—'} sub="total across all trips" />
        <Kpi icon="chat" label="Assistant questions" value={fmt.int(chats)} sub={chats ? `${Math.round((gem / chats) * 100)}% answered with Gemini` : 'last 30 days'} />
        <Kpi icon="bell" label="Price alerts active" value={fmt.int(u.alerts.reduce((a, x) => a + x.n, 0))} sub={`${u.notifications?.n || 0} notifications sent (30 d)`} />
        <Kpi icon="pin" label="Community reports" value={fmt.int(u.reports)} sub="last 14 days" />
      </KpiGrid>
      <Section title="Trips per day" icon="route" desc="Estimates run each day (bars), with the average trip cost (dashed line, ₱).">
        <BarChart height={200} labels={days.map((d) => fmt.date(d, { year: false }))} yFormat={(v) => String(Math.round(v))}
          series={[{ label: 'Trips', color: SERIES[0], data: days.map((d) => u.tripsDaily.find((x) => x.day === d)?.n || 0) }]} />
        <LineChart height={150} labels={days.map((d) => fmt.date(d, { year: false }))} series={[{ label: 'Avg cost ₱', color: SERIES[1], data: days.map((d) => { const x = u.tripsDaily.find((y) => y.day === d); return x ? Math.round(x.avg_cost) : null; }) }]} valueFormat={(v) => fmt.peso(v, 0)} yFormat={(v) => `₱${Math.round(v)}`} />
      </Section>
      <Section title="Vehicle types" icon="car" desc="What people drive when they plan trips.">
        {u.categories.length ? <Donut data={u.categories.map((r, i) => ({ label: r.category || 'unknown', value: r.n, color: SERIES[i % SERIES.length] }))} /> : <Empty icon="🚗" title="No trips yet" />}
      </Section>
      <Section title="Most-used vehicles" icon="car">{u.topVehicles.length ? <HBarChart items={items(u.topVehicles, 'name', SERIES[2])} /> : <Empty icon="🏍️" title="No trips yet" />}</Section>
      <Section title="Trips by region" icon="pin" desc="Based on where trips start.">{u.tripRegions.length ? <HBarChart items={items(u.tripRegions, 'region', SERIES[3])} /> : <Empty icon="🗺️" title="No trips yet" />}</Section>
      <Section title="What people ask the assistant" icon="chat" desc="Detected question type.">{u.intents.length ? <HBarChart items={items(u.intents.map((i) => ({ ...i, intent: i.intent.replace(/_/g, ' ') })), 'intent', SERIES[1])} /> : <Empty icon="💬" title="No questions yet" />}</Section>
      <Section title="Assistant questions per day" icon="chat">
        <LineChart height={160} labels={days.map((d) => fmt.date(d, { year: false }))} series={[{ label: 'Questions', color: SERIES[1], fill: true, data: days.map((d) => u.chatsDaily.find((x) => x.day === d)?.n || 0) }]} yFormat={(v) => String(Math.round(v))} />
      </Section>
    </>
  );
}

// ======================================================== Users & reports
function Users({ D }) {
  const t = useTheme();
  const { user } = useApp();
  const [list, setList] = useState(null);
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => { try { const [a, b] = await Promise.all([api('/admin/users'), api('/admin/reports')]); setList(a); setReports(b); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  if (error) return <AlertBox level="danger" text={error} />;
  if (!list) return <Loading />;
  const setRole = (u, role) => {
    if (role === u.role) return;
    Alert.alert(`Make ${u.name} ${role === 'admin' ? 'an admin' : 'a regular user'}?`, role === 'admin' ? 'Admins can open this monitor, run jobs and change roles.' : 'They will lose access to this monitor.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change', onPress: async () => { try { await api(`/admin/users/${u.id}/role`, { method: 'PUT', body: { role } }); toast(`${u.name} is now ${role === 'admin' ? 'an admin' : 'a regular user'}`); load(); } catch (e) { toast(e.message, 'error'); } } },
    ]);
  };
  const alerts = D.stats.usage.alerts;
  return (
    <>
      <Section title={`Users (${list.length})`} icon="user" desc="People with an account. Admins can open this monitor. There must always be at least one admin.">
        {list.length ? list.map((u) => (
          <View key={u.id} style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 8, gap: 4 }}>
            <Row between>
              <View style={{ flex: 1 }}><Txt bold>{u.name}{u.id === user.id ? <Txt tone="faint"> (you)</Txt> : null}</Txt><Txt variant="small" tone="muted">{u.email}</Txt></View>
              <Seg value={u.role} onChange={(r) => setRole(u, r)} items={[['user', 'User'], ['admin', 'Admin']]} />
            </Row>
            <Txt variant="tiny" tone="faint">Joined {fmt.date(u.created_at)} · last sign-in {u.last_login ? fmt.ago(u.last_login) : '—'} · {u.vehicles} vehicles · {u.trips} trips · {u.fill_ups} fill-ups · {u.alerts} alerts</Txt>
          </View>
        )) : <Txt tone="muted">No users yet.</Txt>}
      </Section>
      <Section title="Active price alerts" icon="bell" desc="What people asked to be notified about.">
        {alerts.length ? <KpiGrid>{alerts.map((a) => <Kpi key={a.kind} label={{ below: 'Price drops below', above: 'Price rises above', adjustment: 'Every adjustment', rollback: 'Rollback expected' }[a.kind] || a.kind} value={fmt.int(a.n)} />)}</KpiGrid> : <Txt tone="muted">No alerts set yet.</Txt>}
      </Section>
      <Section title={`Community price reports (${reports.length})`} icon="pin" desc="Prices users reported at stations. They show on Stations for 14 days. Remove anything that looks wrong or abusive.">
        {reports.length ? reports.map((r) => (
          <Row key={r.id} between style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Txt variant="small" bold>{r.station || r.station_osm_id}{r.brand ? ` (${r.brand})` : ''}</Txt>
              <Txt variant="small">{r.product} · {fmt.peso(r.price)}{r.note ? ` · “${r.note}”` : ''}</Txt>
              <Txt variant="tiny" tone="faint">{fmt.ago(r.reported_at)} · {r.email || '—'}</Txt>
            </View>
            <Btn small variant="ghost" icon="trash" onPress={async () => { try { await api(`/admin/reports/${r.id}`, { method: 'DELETE' }); toast('Report removed'); load(); } catch (e) { toast(e.message, 'error'); } }} />
          </Row>
        )) : <Txt tone="muted">No reports yet.</Txt>}
      </Section>
    </>
  );
}

// ======================================================== Tools
function Tools({ D }) {
  const [f, setF] = useState({ region: 'NCR', product: 'RON91', week: '', common: '', min: '', max: '' });
  const [csv, setCsv] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      <Section title="Enter a price by hand" icon="plus" desc="For a week whose DOE report could not be read (scanned or new layout). Manual prices are labelled as such wherever they appear.">
        <Row gap={10}>
          <Field label="Region"><Select value={f.region} onChange={(v) => set('region', v)} title="Region" options={REGIONS.map((r) => ({ value: r, label: r }))} /></Field>
          <Field label="Fuel"><Select value={f.product} onChange={(v) => set('product', v)} title="Fuel" options={['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'].map((p) => ({ value: p, label: p }))} /></Field>
        </Row>
        <Field label="Week start (a Tuesday, YYYY-MM-DD)"><Input value={f.week} onChangeText={(v) => set('week', v)} placeholder="2026-10-20" autoCapitalize="none" /></Field>
        <Row gap={10}>
          <Field label="Common price"><Input value={f.common} onChangeText={(v) => set('common', v)} keyboardType="decimal-pad" placeholder="81.70" /></Field>
          <Field label="Lowest"><Input value={f.min} onChangeText={(v) => set('min', v)} keyboardType="decimal-pad" placeholder="optional" /></Field>
          <Field label="Highest"><Input value={f.max} onChangeText={(v) => set('max', v)} keyboardType="decimal-pad" placeholder="optional" /></Field>
        </Row>
        <Btn title="Save price" variant="primary" block onPress={async () => {
          try { await api('/admin/prices', { method: 'POST', body: { entries: [{ region: f.region, product: f.product, weekStart: f.week, common: Number(f.common), min: Number(f.min) || null, max: Number(f.max) || null }] } }); toast('Price saved'); } catch (e) { toast(e.message, 'error'); }
        }} />
      </Section>
      <Section title="Import many prices (CSV)" icon="download" desc="Paste rows with these columns: region, area, brand, product, min, max, common, week_start. Use ALL for area and brand for region-wide prices.">
        <Input value={csv} onChangeText={setCsv} multiline autoCapitalize="none" placeholder={'region,area,brand,product,min,max,common,week_start\nVisayas,ALL,ALL,RON91,84.10,92.50,88.20,2026-10-20'} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        <Btn title="Import CSV" onPress={async () => {
          try { const r = await api('/admin/prices/csv', { method: 'POST', body: { csv } }); toast(`Imported ${r.saved} rows${r.skippedLines.length ? `, skipped lines ${r.skippedLines.join(', ')}` : ''}`); } catch (e) { toast(e.message, 'error'); }
        }} />
      </Section>
      <Section title="Cache" icon="refresh" desc={`TipidLitro keeps copies of answers from outside services to stay fast and within free limits. ${fmt.int(D.monitor.counts.cache_rows)} entries stored. Clearing forces fresh calls.`}>
        <Btn title="Clear all cached answers" variant="danger" onPress={() => Alert.alert('Clear the cache?', 'The next requests will call the outside services again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: async () => { try { await api('/admin/cache/clear', { method: 'POST', body: {} }); toast('Cache cleared'); } catch (e) { toast(e.message, 'error'); } } }])} />
      </Section>
    </>
  );
}

// ======================================================== System
function System({ D }) {
  const t = useTheme();
  const [log, setLog] = useState(null);
  const s = D.stats; const sys = s.system;
  const yes = (b, extra = '') => <Badge label={b ? `set${extra}` : 'not set'} tone={b ? 'green' : 'gray'} />;
  const tables = [...s.tables].sort((a, b) => b.rows - a.rows);
  return (
    <>
      <Section title="Server" icon="gear">
        <KV rows={[['TipidLitro', `v${sys.version}`], ['Node.js', sys.node], ['Operating system', sys.platform], ['CPU cores', sys.cpus], ['Running for', dur(sys.uptimeSec)], ['Memory used', `${sys.memoryMb} MB (heap ${sys.heapMb} MB)`], ['Free system memory', `${fmt.int(sys.freeMemMb)} MB`], ['Today in Manila', fmt.date(sys.manilaDate, { weekday: 'short' })]]} />
      </Section>
      <Section title="Database" icon="save">
        <KV rows={[['Engine', sys.database], ['Size on disk', bytes(sys.dbBytes)], ['Scheduler', sys.scheduler ? 'on (automatic sync)' : 'off'], ['Total rows', fmt.int(s.tables.reduce((a, x) => a + x.rows, 0))], ['Switch engines', 'DB_CLIENT=sqlite or mysql in .env']]} />
      </Section>
      <Section title="API keys and settings" icon="gear" desc="Read from .env when the server starts. Keys are never shown. Edit .env and restart to change them.">
        <KV rows={[
          ['Gemini (assistant)', yes(sys.keys.gemini, ` · ${sys.settings.geminiModel}`)], ['EIA (Brent)', yes(sys.keys.eia)], ['FRED (Brent)', yes(sys.keys.fred)], ['GNews', yes(sys.keys.gnews)],
          ['NewsData.io', yes(sys.keys.newsdata)], ['Contact email (OSM)', yes(sys.keys.contactEmail)], ['DOE weeks checked hourly', String(sys.settings.doeBackfillWeeks)],
          ['EV electricity rate', `₱${sys.settings.electricityRate}/kWh`], ['Routing server', sys.settings.osrmUrl],
        ]} />
      </Section>
      <Section title="Rows per table" icon="trend" desc="Where the data lives. fuel_prices holds every DOE price since 2017.">
        <HBarChart items={tables.map((x) => ({ label: x.table, value: Math.log10(x.rows + 1), display: fmt.int(x.rows) }))} color={SERIES[0]} />
        <Txt variant="tiny" tone="faint">Bar length uses a log scale so small tables stay visible.</Txt>
      </Section>
      <Section title="Recent outbound calls" icon="bolt" desc="The last 60 requests to outside systems. API keys are hidden." collapsible defaultOpen={false}>
        {!log ? <Btn small title="Load calls" onPress={() => api('/admin/log?limit=60').then(setLog).catch((e) => toast(e.message, 'error'))} /> : log.map((l) => (
          <View key={l.id} style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 6 }}>
            <Row between><Row gap={6}><View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: l.ok ? t.green : t.red }} /><Txt variant="small" bold>{short(l.source)}</Txt></Row><Txt variant="tiny" tone="muted">{fmt.ago(l.created_at)} · {l.status_code ?? '—'} · {l.duration_ms} ms</Txt></Row>
            <Txt variant="tiny" tone="muted" numberOfLines={2}>{l.endpoint}</Txt>
            {l.error ? <Txt variant="tiny" tone="red" numberOfLines={2}>{l.error.slice(0, 160)}</Txt> : null}
          </View>
        ))}
      </Section>
      <Row gap={6}><Icon name="info" size={14} color={t.faint} /><Txt variant="tiny" tone="faint">Pull down to refresh. The dashboard refreshes every 45 s (every 5 s while a job runs).</Txt></Row>
    </>
  );
}
