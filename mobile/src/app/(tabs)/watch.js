// Price Watch (port of public/js/views/forecast.js): a plain answer first ("next Tuesday, gasoline
// likely down ₱1.75"), with the pump prices, drivers, charts, accuracy and method below.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BarChart, LineChart } from '../../components/charts';
import { AlertBox, Card, Gauge, Loading, PageHeader, Row, Screen, Section, SectionTitle, Stat, StatGrid, Term, Tip, Txt } from '../../components/ui';
import { api } from '../../lib/api';
import { fmt } from '../../lib/format';
import { useTheme } from '../../lib/theme';

const NAMES = { GASOLINE: 'Gasoline', DIESEL: 'Diesel', KEROSENE: 'Kerosene' };
const value = (p) => p.announced ?? p.estimate;
const word = (v) => (v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'about the same');
const arrow = (v) => (v > 0.05 ? '▲' : v < -0.05 ? '▼' : '≈');
const tone = (v) => (v > 0.05 ? 'up' : v < -0.05 ? 'down' : undefined);

function DriverRow({ label, sub, tip, value: v, bold }) {
  const t = useTheme();
  return (
    <Row between align="flex-start" style={{ borderBottomWidth: 1, borderColor: t.border, paddingVertical: 6 }}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Row gap={0}><Txt variant="small" bold={bold}>{label}</Txt>{tip ? <Tip text={tip} title={label} /> : null}</Row>
        {sub ? <Txt variant="tiny" tone="muted">{sub}</Txt> : null}
      </View>
      <Txt variant="small" bold={bold}>{v}</Txt>
    </Row>
  );
}

export default function Watch() {
  const t = useTheme();
  const [f, setF] = useState(null);
  const [market, setMarket] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const [a, b] = await Promise.all([api('/forecast'), api('/market?days=150')]); setF(a); setMarket(b); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const header = <PageHeader title="Price Watch" help="watch" subtitle="Will pump prices go up or down next Tuesday?" />;
  if (error && !f) return <Screen onRefresh={load}>{header}<AlertBox level="warn" text={`The estimate is not available yet: ${error}`} /></Screen>;
  if (!f) return <Screen>{header}<Card><Loading text="Checking oil prices and past adjustments…" /></Card></Screen>;

  const daysLeft = Math.max(0, Math.round((new Date(`${f.targetWeekStart}T06:00:00+08:00`) - Date.now()) / 86400000));
  const when = fmt.date(f.targetWeekStart, { weekday: 'long', long: true, year: false });
  const gas = f.products.find((p) => p.product === 'GASOLINE'); const dsl = f.products.find((p) => p.product === 'DIESEL');
  const announced = f.products.some((p) => p.announced != null);
  const b = f.basis; const pr = f.pressure;
  const ws = [...new Set(f.history.map((x) => x.weekStart))];
  const pick = (w, p, k) => f.history.find((x) => x.weekStart === w && x.product === p)?.[k] ?? null;

  return (
    <Screen onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} refreshing={refreshing}>
      {header}
      {f._offline ? <AlertBox level="warn" text="You're offline — showing the last estimate saved on this phone." /> : null}

      <Card tone="welcome">
        <SectionTitle style={{ marginTop: 0 }}>{announced ? 'Announced by oil companies' : `Estimate · ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`}`}</SectionTitle>
        <Txt variant="h2">Next price change: {when}</Txt>
        {f.products.map((p) => {
          const v = value(p);
          return (
            <View key={p.product} style={{ gap: 0 }}>
              <Row gap={10}>
                <Txt bold style={{ minWidth: 80 }}>{NAMES[p.product]}</Txt>
                <Txt variant="h1" tone={tone(v)}>{arrow(v)} {fmt.signedPeso(v)}</Txt>
              </Row>
              <Txt variant="small" tone="muted" style={{ marginLeft: 90 }}>per liter — likely {word(v)}{p.announced == null ? ` (between ${fmt.signedPeso(p.low)} and ${fmt.signedPeso(p.high)})` : ''}</Txt>
            </View>
          );
        })}
        {[gas, dsl].filter(Boolean).map((p) => (
          <View key={p.product} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: p.advice.action === 'fill_now' ? t.amberSoft : p.advice.action === 'wait' ? t.greenSoft : t.surface, borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 24 }}>{p.advice.action === 'fill_now' ? '⛽' : p.advice.action === 'wait' ? '⏳' : '👌'}</Text>
            <View style={{ flex: 1 }}>
              <Txt variant="tiny" tone="muted" bold style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{NAMES[p.product]} tip</Txt>
              <Txt variant="small">{p.advice.text}</Txt>
            </View>
          </View>
        ))}
        {announced ? <Txt variant="small" tone="muted">These are the official amounts filed with DOE.</Txt> : (
          <Row wrap gap={0}>
            <Txt variant="small" tone="muted">This is an estimate, not the official number. </Txt>
            <Term k="confidence" label="Confidence" /><Txt variant="small" tone="muted">: {gas?.confidence || 'low'}. Oil companies announce the real change on Monday.</Txt>
          </Row>
        )}
        {b.lagged ? <Txt variant="small" tone="muted">Latest free oil data is from {fmt.date(b.latestBrentDate)}, so treat it as a rough guide.</Txt> : null}
      </Card>

      <Section title="What it means at the pump (NCR)" icon="fuel" desc="This week's common price and what it becomes if the change happens.">
        <StatGrid>
          {f.products.map((p) => (
            <View key={p.product} style={{ flexBasis: '100%', backgroundColor: t.surface2, borderRadius: 9, borderWidth: 1, borderColor: t.border, padding: 10, gap: 3 }}>
              <Txt variant="tiny" tone="faint" bold style={{ textTransform: 'uppercase' }}>{NAMES[p.product]}</Txt>
              {p.pumps.length ? p.pumps.map((x) => (
                <Row key={x.product} between>
                  <Txt variant="small">{x.product === 'RON97_100' ? 'RON97/100' : x.product.replace('_', ' ')}</Txt>
                  <Txt variant="small">{fmt.peso(x.current)} → <Txt variant="small" bold>{fmt.peso(x.projected)}</Txt></Txt>
                </Row>
              )) : <Txt variant="small" tone="muted">No NCR price on file</Txt>}
            </View>
          ))}
        </StatGrid>
      </Section>

      <Section title="What is driving it" icon="trend" desc="Pump prices follow world oil prices and the peso, with about a week's delay." collapsible defaultOpen={false}>
        <DriverRow label="World oil price (Brent)" sub={b.window} tip="Average of the latest trading days vs the week before, US dollars per barrel." value={`$${fmt.num(b.brentPrevAvg, 2)} → $${fmt.num(b.brentAvg, 2)}`} />
        <DriverRow label="US dollar in pesos" sub="A weaker peso makes imported fuel more expensive" value={`₱${fmt.num(b.fxPrevAvg, 2)} → ₱${fmt.num(b.fxAvg, 2)}`} />
        <DriverRow label="Crude oil cost per liter" sub="Brent × USD/PHP ÷ 159 liters in a barrel" value={`${fmt.peso(b.crudePhpPerLPrev)} → ${fmt.peso(b.crudePhpPerL)}`} />
        <DriverRow label="Change in crude cost" bold value={fmt.signedPeso(b.rawDelta)} />
        {pr ? (
          <View style={{ gap: 6, marginTop: 6 }}>
            <Row between><Term k="pressure" label="News headlines this week" variant="small" tone={undefined} /><Txt variant="small" tone="muted">{pr.up} up · {pr.down} down</Txt></Row>
            <Gauge up={pr.up} down={pr.down} />
            <Pressable onPress={() => router.push('/news')}><Txt variant="tiny" tone="faint">Context only — headlines are not used in the number. <Txt variant="tiny" tone="brand" bold>Read the news</Txt></Txt></Pressable>
          </View>
        ) : null}
      </Section>

      {market ? (
        <Section title="Oil price and peso charts" icon="trend" desc="Last 5 months. Touch and drag to read values." collapsible defaultOpen={false}>
          <SectionTitle>Brent crude (US$ per barrel)</SectionTitle>
          <LineChart labels={market.brent.map((r) => fmt.date(r.date, { year: false }))} series={[{ label: 'Brent', color: '#ea580c', data: market.brent.map((r) => r.value) }]} valueFormat={(v) => `$${fmt.num(v, 2)}`} yFormat={(v) => `$${Math.round(v)}`} />
          <SectionTitle>US dollar in pesos</SectionTitle>
          <LineChart labels={market.usdphp.map((r) => fmt.date(r.date, { year: false }))} series={[{ label: 'USD/PHP', color: '#2563eb', data: market.usdphp.map((r) => r.value) }]} valueFormat={(v) => `₱${fmt.num(v, 2)}`} yFormat={(v) => `₱${v.toFixed(1)}`} />
        </Section>
      ) : null}

      <Section title="How accurate is this?" icon="info" desc="Bars are the real weekly changes; dashed lines are what the model would have said." collapsible defaultOpen={false}>
        {ws.length ? (
          <BarChart height={220} labels={ws.map((w) => fmt.date(w, { year: false }))} valueFormat={(v) => fmt.signedPeso(v)} yFormat={(v) => `₱${v.toFixed(1)}`}
            series={[
              { label: 'Gasoline (actual)', color: 'rgba(234,88,12,0.75)', data: ws.map((w) => pick(w, 'GASOLINE', 'actual')) },
              { label: 'Gasoline (model)', color: '#ea580c', type: 'line', data: ws.map((w) => pick(w, 'GASOLINE', 'predicted')) },
              { label: 'Diesel (actual)', color: 'rgba(14,165,233,0.75)', data: ws.map((w) => pick(w, 'DIESEL', 'actual')) },
              { label: 'Diesel (model)', color: '#0ea5e9', type: 'line', data: ws.map((w) => pick(w, 'DIESEL', 'predicted')) },
            ]} />
        ) : <Txt tone="muted">Not enough history yet.</Txt>}
        <StatGrid>
          {f.products.map((p) => <Stat key={p.product} k={NAMES[p.product]} v={p.calibration.calibrated ? `±₱${p.calibration.rmse}` : '—'} s={p.calibration.calibrated ? `typical error, learned from ${p.calibration.n} weeks` : 'not enough history yet'} />)}
        </StatGrid>
      </Section>

      <Section title="How we estimate" icon="info" collapsible defaultOpen={false}>
        <Txt variant="small">Oil companies set Tuesday’s change from the previous week’s average Singapore fuel prices (MOPS). MOPS is paid data, so TipidLitro uses the free Brent crude price and the USD/PHP rate instead.</Txt>
        <Txt variant="small">We compare this week’s crude cost per liter with last week’s, then adjust using what actually happened in past weeks (a simple model per fuel, learned from DOE’s adjustment notices). The range shows the model’s typical error.</Txt>
        <Txt variant="small">Gasoline and diesel do not always follow crude — taxes, subsidies and refinery issues can change things. On Monday the official numbers replace this estimate.</Txt>
      </Section>
    </Screen>
  );
}
