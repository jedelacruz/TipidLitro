// Fuel Prices (port of public/js/views/prices.js): official DOE prices by region in four views —
// this week, history, by city & brand, and weekly adjustments. Any past week back to 2017 can be opened.
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BarChart, LineChart } from '../../components/charts';
import {
  AlertBox, Badge, Btn, Card, Chip, Empty, Field, Loading, PageHeader, Row, Screen, Section, Select, Table, Tabs, Term, Tip, Txt, toast,
} from '../../components/ui';
import { api, prefs } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { fmt, PRODUCT_LABELS, REGIONS, SHORT_PRODUCT } from '../../lib/format';
import { shareCsv } from '../../lib/nav';
import { brandColor, SERIES, useTheme } from '../../lib/theme';

const COLS = ['RON91', 'RON95', 'RON97_100', 'RON97', 'RON100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'];
const HIST_PRODUCTS = ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'];
const RANGES = [['26', '6M'], ['52', '1Y'], ['156', '3Y'], ['260', '5Y'], ['all', 'All']];
const VIEWS = ['week', 'history', 'cities', 'adjust'];

/** Green (cheap) → red (expensive) background relative to the column's min/max. */
const heat = (v, min, max) => (v == null || max === min ? 'transparent' : `hsla(${145 - ((v - min) / (max - min)) * 140}, 70%, 45%, 0.18)`);
const yearsAgo = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };
const daysBefore = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);
const openLink = (url) => WebBrowser.openBrowserAsync(url).catch(() => toast('Could not open the link', 'error'));

function ChangeKpis({ w }) {
  return (
    <Row gap={22} wrap>
      {['GASOLINE', 'DIESEL', 'KEROSENE'].map((k) => (
        <View key={k}>
          <Txt variant="small" tone="muted" bold>{k[0] + k.slice(1).toLowerCase()}</Txt>
          <Txt variant="h2" tone={w[k] > 0 ? 'up' : w[k] < 0 ? 'down' : undefined}>{w[k] == null ? '—' : `${w[k] > 0 ? '▲' : w[k] < 0 ? '▼' : ''} ${fmt.signedPeso(w[k])}`}</Txt>
        </View>
      ))}
    </Row>
  );
}

export default function Prices() {
  const params = useLocalSearchParams();
  const { status, refreshStatus } = useApp();
  const [region, setRegion] = useState(REGIONS.includes(params.region) ? params.region : 'NCR');
  const [view, setView] = useState(VIEWS.includes(params.view) ? params.view : 'week');
  const [week, setWeek] = useState('');
  const [compare, setCompare] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [D, setD] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => { if (REGIONS.includes(params.region)) setRegion(params.region); if (VIEWS.includes(params.view)) setView(params.view); }, [params.region, params.view]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ ...(week ? { week } : {}), ...(compare ? { compare } : {}) });
      const [data, adj, weeks] = await Promise.all([
        api(`/prices/region/${encodeURIComponent(region)}?${qs}`),
        api('/prices/adjustments?weeks=52'),
        api(`/prices/weeks?region=${encodeURIComponent(region)}`),
      ]);
      setD({ data, adj, weeks });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [region, week, compare]);
  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api('/prices/check', { method: 'POST' });
      if (r.status === 'recent') toast(`Already checked ${fmt.ago(r.checkedAt)} — nothing newer yet`);
      else if (r.status === 'running') toast('A check is already running');
      else if (/imported [1-9]/.test(r.message || '')) toast('New DOE data imported!');
      else toast('Up to date — no new DOE reports');
      await refreshStatus(); await load();
    } catch (e) { toast(e.message, 'error'); }
    setChecking(false);
  };
  const changeRegion = (r) => { setRegion(r); setWeek(''); setCompare(''); setPickerOpen(false); };
  const s = D?.data?.summary;

  return (
    <Screen onRefresh={load} refreshing={false}>
      <PageHeader title="Fuel prices" help="prices" subtitle="Official DOE pump prices — this week and every week back to 2017." />
      <Row between>
        <Row gap={0} style={{ flex: 1 }}>
          <Txt variant="small" tone="muted">{status?.doe?.checkedAt ? `Checked DOE ${fmt.ago(status.doe.checkedAt)}` : 'Checks DOE every hour'}</Txt>
          <Tip text="TipidLitro looks for new DOE reports every hour automatically. You can also check right now." />
        </Row>
        <Btn small icon="refresh" title={checking ? 'Checking…' : 'Check DOE now'} loading={checking} onPress={checkNow} />
      </Row>
      <Tabs pills items={REGIONS.map((r) => [r, r])} value={region} onChange={changeRegion} />
      <Tabs items={[['week', 'This week'], ['history', 'History'], ['cities', region === 'NCR' ? 'By city & brand' : 'By report'], ['adjust', 'Adjustments']]} value={view} onChange={setView} />
      {D?.data?._offline ? <AlertBox level="warn" text="You're offline — showing the last prices saved on this phone." /> : null}
      {error ? <AlertBox level="danger" text={error} action={<Btn small title="Retry" onPress={load} />} /> : null}
      {loading && !D ? <Card><Loading text="Loading DOE prices…" /></Card> : null}
      {D && !s?.weekStart ? <Card><Empty title={`No ${region} prices yet`} text={'TipidLitro is still downloading DOE reports. Try again in a minute, or tap "Check DOE now".'} /></Card> : null}
      {D && s?.weekStart ? (
        view === 'week' ? <WeekView D={D} region={region} compare={compare} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} setWeek={setWeek} setCompare={setCompare} goAdjust={() => setView('adjust')} />
          : view === 'history' ? <HistoryView key={region} D={D} region={region} />
            : view === 'cities' ? <CitiesView key={`${region}${s.weekStart}`} D={D} region={region} />
              : <AdjustView D={D} />
      ) : null}
      {loading && D ? <Loading text="Updating…" /> : null}
    </Screen>
  );
}

// ---------------------------------------------------------- This week
function WeekView({ D, region, compare, pickerOpen, setPickerOpen, setWeek, setCompare, goAdjust }) {
  const t = useTheme();
  const { data, weeks, adj } = D; const s = data.summary;
  const list = weeks.weeks;
  const first = list[list.length - 1];
  const cmpOptions = [
    { value: '', label: 'The week before' }, { value: daysBefore(s.weekStart, 28), label: '4 weeks before' },
    { value: yearsAgo(s.weekStart, 1), label: '1 year before' }, { value: yearsAgo(s.weekStart, 3), label: '3 years before' }, { value: yearsAgo(s.weekStart, 5), label: '5 years before' },
  ];
  const w0 = adj.weeks[0];
  return (
    <>
      <Card>
        <Row between align="flex-start">
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="h2">Week of {fmt.week(s.weekStart, s.weekEnd)}</Txt>
            <Txt variant="small" tone="muted">{s.isLatest ? 'The latest DOE report on file.' : 'A past week.'}{s.estimated ? ' Regional prices are estimates from the field office report.' : ''}</Txt>
          </View>
          {!s.isLatest ? <Badge label="Past week" tone="blue" /> : s.stale ? <Badge label={`${s.ageDays} days old`} tone="amber" /> : <Badge label="Latest" tone="green" />}
        </Row>
        <Row wrap gap={6}>
          {!s.isLatest || compare ? <Btn small title="Back to latest" onPress={() => { setWeek(''); setCompare(''); setPickerOpen(false); }} /> : null}
          <Btn small icon="calendar" title={pickerOpen ? 'Hide' : 'Change week'} onPress={() => setPickerOpen(!pickerOpen)} />
          {s.sourceUrl?.startsWith('http') ? <Btn small icon="external" title="Source PDF" variant="ghost" onPress={() => openLink(s.sourceUrl)} /> : null}
        </Row>
        {pickerOpen ? (
          <View style={{ gap: 10 }}>
            <Field label="Show week"><Select value={s.isLatest ? '' : s.weekStart} title="Show week" onChange={setWeek} options={list.map((w, i) => ({ value: i === 0 ? '' : w.weekStart, label: `${fmt.week(w.weekStart, w.weekEnd)}${i === 0 ? ' (latest)' : ''}` }))} /></Field>
            <Field label="Compare with"><Select value={compare} title="Compare with" onChange={setCompare} groups={[{ title: 'Quick picks', options: cmpOptions }, { title: 'A specific week', options: list.map((w) => ({ value: w.weekStart, label: fmt.week(w.weekStart, w.weekEnd) })) }]} /></Field>
            <Txt variant="tiny" tone="faint">{list.length} weeks on file{first ? ` since ${fmt.date(first.weekStart)}` : ''}</Txt>
          </View>
        ) : null}
        <Row wrap gap={10}>
          <Row gap={0}><Txt variant="small" tone="muted" bold>Big number = </Txt><Term k="common" /></Row>
          <Row gap={0}><Txt variant="small" tone="muted" bold>Range</Txt><Tip text="Cheapest to most expensive station DOE saw that week." /></Row>
          <Txt variant="small" tone="muted">▲▼ = change vs {s.compareWeek ? fmt.date(s.compareWeek) : 'the week before'}</Txt>
        </Row>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {s.products.map((p) => (
          <View key={p.product} style={{ flexBasis: '46%', flexGrow: 1, backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 12, gap: 2 }}>
            <Txt variant="small" tone="muted" bold numberOfLines={1}>{p.label}</Txt>
            <Text style={{ fontSize: 24, fontWeight: '800', color: t.text }}>{fmt.peso(p.common)}</Text>
            <Txt variant="tiny" tone="faint">{fmt.peso(p.min)} – {fmt.peso(p.max)}</Txt>
            {p.change != null ? (
              <Txt variant="small" bold tone={p.change > 0 ? 'up' : p.change < 0 ? 'down' : 'muted'}>
                {p.change > 0 ? '▲' : p.change < 0 ? '▼' : '•'} {fmt.signedPeso(p.change)}
                {compare && p.compareCommon ? <Txt variant="tiny" tone="faint"> (was {fmt.peso(p.compareCommon)}, {p.change >= 0 ? '+' : ''}{((p.change / p.compareCommon) * 100).toFixed(1)}%)</Txt> : null}
              </Txt>
            ) : null}
          </View>
        ))}
      </View>

      {w0 && s.isLatest ? (
        <Section title="Latest price adjustment" icon="bolt" desc={`Took effect ${fmt.date(w0.weekStart, { weekday: 'long', long: true, year: false })}. Oil companies change prices every Tuesday at 6 AM.`} actions={<Btn small title="All" onPress={goAdjust} />}>
          <ChangeKpis w={w0} />
          <Pressable onPress={() => router.navigate('/watch')}><Txt variant="small" tone="faint">Want to know next week’s change? <Txt variant="small" tone="brand" bold>See Price Watch</Txt></Txt></Pressable>
        </Section>
      ) : null}
      {region !== 'NCR' ? <Txt variant="tiny" tone="faint">Outside NCR, DOE publishes field-office price ranges; the big number is the most common price reported.</Txt> : null}
    </>
  );
}

// ---------------------------------------------------------- History
function HistoryView({ D, region }) {
  const [picked, setPicked] = useState(new Set(['RON91', 'RON95', 'DIESEL']));
  const [range, setRange] = useState('52');
  const [area, setArea] = useState('');
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { setPicked(new Set(await prefs.get('histProducts', ['RON91', 'RON95', 'DIESEL']))); setRange(await prefs.get('histRange', '52')); })(); }, []);
  const n = range === 'all' ? 1000 : Number(range);
  const prods = HIST_PRODUCTS.filter((p) => picked.has(p));
  useEffect(() => {
    if (!prods.length) { setHist(null); return; }
    let live = true;
    setBusy(true);
    api(`/prices/history?region=${encodeURIComponent(region)}&products=${prods.join(',')}&weeks=${n}${area ? `&area=${encodeURIComponent(area)}` : ''}`)
      .then((h) => { if (live) setHist(h); }).catch(() => {}).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [region, area, n, prods.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p) => { const next = new Set(picked); if (next.has(p)) next.delete(p); else next.add(p); setPicked(next); prefs.set('histProducts', [...next]); };
  const series = hist ? Object.entries(hist.series).filter(([p, rows]) => rows.length && picked.has(p)) : [];
  const labels = [...new Set(series.flatMap(([, rows]) => rows.map((x) => x.week_start)))].sort();
  const csvPath = `/prices/export.csv?region=${encodeURIComponent(region)}${area ? `&area=${encodeURIComponent(area)}` : ''}${range === 'all' ? '' : `&from=${new Date(Date.now() - n * 7 * 86400000).toISOString().slice(0, 10)}`}`;
  const areas = D.weeks.areas.filter((a) => a.weeks > 1);

  return (
    <Section title={`${region} price history`} icon="trend" desc="The common price each week. Tap a fuel to show or hide it; pick a time range or a city.">
      <Row wrap gap={6}>{HIST_PRODUCTS.map((p) => <Chip key={p} label={SHORT_PRODUCT[p]} on={picked.has(p)} onPress={() => toggle(p)} />)}</Row>
      <Row wrap gap={6}>{RANGES.map(([k, label]) => <Chip key={k} label={label} on={range === k} onPress={() => { setRange(k); prefs.set('histRange', k); }} />)}</Row>
      <Row gap={8}>
        {areas.length ? <View style={{ flex: 1 }}><Select value={area} title="City or area" onChange={setArea} options={[{ value: '', label: `${region} (all)` }, ...areas.map((a) => ({ value: a.area, label: a.area, sub: `${a.weeks} weeks` }))]} /></View> : <View style={{ flex: 1 }} />}
        <Btn small icon="download" title="CSV" onPress={() => shareCsv(csvPath, `tipidlitro-${region.toLowerCase().replace(/\s+/g, '-')}${area ? `-${area.toLowerCase().replace(/\s+/g, '-')}` : ''}.csv`).catch((e) => toast(e.message, 'error'))} />
      </Row>
      {series.map(([p, rows]) => {
        const ok = rows.filter((x) => x.common != null); if (ok.length < 2) return null;
        const a = ok[0]; const b = ok[ok.length - 1];
        const lo = ok.reduce((m, x) => (x.common < m.common ? x : m)); const hi = ok.reduce((m, x) => (x.common > m.common ? x : m));
        return (
          <Row key={p} gap={6} align="flex-start">
            <View style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: SERIES[HIST_PRODUCTS.indexOf(p)], marginTop: 5 }} />
            <Txt variant="small" style={{ flex: 1 }}><Txt variant="small" bold>{SHORT_PRODUCT[p]}</Txt>: {fmt.peso(a.common)} → {fmt.peso(b.common)} <Txt variant="small" tone={b.common > a.common ? 'up' : 'down'}>({fmt.signedPeso(b.common - a.common)})</Txt><Txt variant="small" tone="muted"> · low {fmt.peso(lo.common)} ({fmt.date(lo.week_start, { day: false })}) · high {fmt.peso(hi.common)} ({fmt.date(hi.week_start, { day: false })})</Txt></Txt>
          </Row>
        );
      })}
      {!prods.length ? <Txt tone="muted">Tap a fuel above to show its prices.</Txt>
        : busy && !hist ? <Loading />
          : labels.length ? (
            <LineChart height={240} labels={labels.map((l) => fmt.date(l, labels.length > 60 ? { shortYear: true } : { year: false }))}
              series={series.map(([p, rows]) => ({ label: PRODUCT_LABELS[p], color: SERIES[HIST_PRODUCTS.indexOf(p)], data: labels.map((l) => rows.find((x) => x.week_start === l)?.common ?? null) }))}
              valueFormat={(v) => fmt.peso(v)} yFormat={(v) => `₱${Math.round(v)}`} />
          ) : <Txt tone="muted">No data for this choice.</Txt>}
      <Txt variant="tiny" tone="faint">{labels.length < 8 ? 'Only a few weeks are stored so far. An admin can import DOE history back to 2017 from the Integration Monitor.' : `${labels.length} weekly DOE reports${area ? ` for ${area}` : ''}. Gaps are weeks DOE didn't publish or that couldn't be read.`}</Txt>
    </Section>
  );
}

// ---------------------------------------------------------- By city & brand
function CitiesView({ D, region }) {
  const t = useTheme();
  const { data } = D; const s = data.summary;
  const [selected, setSelected] = useState(data.brands.length && data.areas.length ? 0 : null);
  if (!data.areas.length) return <Card><Empty icon="🗺️" title="No breakdown for this week" text="DOE did not publish city-level prices for this region and week." /></Card>;
  const cols = COLS.filter((c) => data.areas.some((a) => a.products[c]));
  const ranges = Object.fromEntries(cols.map((c) => { const v = data.areas.map((a) => a.products[c]?.common).filter((x) => x != null); return [c, [Math.min(...v), Math.max(...v)]]; }));
  const cell = (v, bg, star) => <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}><Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{v}{star ? '*' : ''}</Text></View>;
  const area = selected != null ? data.areas[selected]?.area : null;
  const list = area ? data.brands.filter((b) => b.area === area) : [];
  const brands = [...new Set(list.map((b) => b.brand))];
  const pcols = COLS.filter((c) => list.some((b) => b.product === c));
  const mids = Object.fromEntries(pcols.map((c) => { const v = list.filter((b) => b.product === c).map((b) => (b.min + b.max) / 2); return [c, [Math.min(...v), Math.max(...v)]]; }));
  return (
    <>
      <Section title={region === 'NCR' ? 'Common price by city' : 'By field office report'} icon="pin" desc={`Week of ${fmt.week(s.weekStart, s.weekEnd)} · ₱ per liter · greener = cheaper.${data.brands.length ? ' Tap a city to see each brand.' : ''}`}>
        <Table selectedIndex={selected} onRowPress={data.brands.length ? (_r, i) => setSelected(i) : undefined}
          columns={[{ key: 'area', label: 'Area', align: 'left', width: 130, render: (a) => <Txt variant="small" bold>{a.area}</Txt> },
            ...cols.map((c) => ({ key: c, label: SHORT_PRODUCT[c], width: 84, render: (a) => (a.products[c]?.common == null ? <Txt variant="small" tone="faint">—</Txt> : cell(fmt.num(a.products[c].common, 2), heat(a.products[c].common, ...ranges[c]), a.products[c].estimate)) }))]}
          rows={data.areas} />
        <Txt variant="tiny" tone="faint">* DOE listed no common price; the value is the middle of the brand prices. Swipe the table sideways for more fuels.</Txt>
      </Section>
      {area && brands.length ? (
        <Section title={`${area}: prices by brand`} icon="fuel" desc={'Lowest–highest price DOE recorded for each brand in this city. "Independent" covers smaller brands.'}>
          <Table columns={[{ key: 'brand', label: 'Brand', align: 'left', width: 130, render: (b) => <Row gap={6}><View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: brandColor(b) }} /><Txt variant="small">{b}</Txt></Row> },
            ...pcols.map((c) => ({ key: c, label: SHORT_PRODUCT[c], width: 110, render: (b) => { const x = list.find((y) => y.brand === b && y.product === c); return x ? cell(x.min === x.max ? fmt.num(x.min, 2) : `${fmt.num(x.min, 2)}–${fmt.num(x.max, 2)}`, heat((x.min + x.max) / 2, ...mids[c])) : <Txt variant="small" tone="faint">—</Txt>; } }))]}
            rows={brands} />
        </Section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------- Adjustments
function AdjustView({ D }) {
  const [showCompanies, setShowCompanies] = useState(false);
  const { latest, weeks } = D.adj;
  if (!weeks.length) return <Card><Empty icon="📉" title="No adjustment notices yet" text="They are imported from DOE every hour." /></Card>;
  const w0 = weeks[0];
  const total = (k) => weeks.reduce((sum, w) => sum + (w[k] || 0), 0);
  const ws = [...weeks].reverse().slice(-26);
  const signed = (v) => <Txt variant="small" tone={v > 0 ? 'up' : v < 0 ? 'down' : undefined}>{v == null ? '—' : fmt.signedPeso(v)}</Txt>;
  return (
    <>
      <Section title={`Effective ${fmt.date(w0.weekStart, { weekday: 'short', year: false })}`} icon="bolt" desc="Change per liter announced by oil companies. Independent stations may differ.">
        <ChangeKpis w={w0} />
        <Txt variant="small" tone="muted">Over the last {weeks.length} notices, the net change is gasoline {fmt.signedPeso(total('GASOLINE'))}, diesel {fmt.signedPeso(total('DIESEL'))}, kerosene {fmt.signedPeso(total('KEROSENE'))} per liter.</Txt>
        <Row wrap gap={6}>
          {latest.companies?.length ? <Btn small icon={showCompanies ? 'up' : 'down'} title={`By oil company (${latest.companies.length})`} onPress={() => setShowCompanies(!showCompanies)} /> : null}
          {latest.sourceUrl ? <Btn small variant="ghost" icon="external" title="Source PDF" onPress={() => openLink(latest.sourceUrl)} /> : null}
        </Row>
        {showCompanies ? (
          <Table columns={[{ key: 'company', label: 'Company', align: 'left', width: 140 }, ...['GASOLINE', 'DIESEL', 'KEROSENE'].map((k) => ({ key: k, label: k[0] + k.slice(1).toLowerCase(), width: 86, render: (c) => signed(c[k]) }))]} rows={latest.companies} />
        ) : null}
      </Section>
      <Section title="Week by week" icon="trend" desc="Bars above zero are price hikes; below zero are rollbacks.">
        <BarChart height={220} labels={ws.map((w) => fmt.date(w.weekStart, { year: false }))}
          series={[['GASOLINE', 'Gasoline', SERIES[0]], ['DIESEL', 'Diesel', SERIES[1]], ['KEROSENE', 'Kerosene', '#94a3b8']].map(([k, label, color]) => ({ label, color, data: ws.map((w) => w[k]) }))}
          valueFormat={(v) => fmt.signedPeso(v)} yFormat={(v) => `₱${v.toFixed(0)}`} />
        <Txt variant="tiny" tone="faint">Last {ws.length} notices. Touch and drag on the chart to see each week.</Txt>
      </Section>
    </>
  );
}
