// Help & how it works (port of public/js/views/about.js): intro again, screen guides, FAQ,
// words to know, how the estimate is made, and limits.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Card, Icon, PageHeader, Row, Screen, Section, Sheet, Txt } from '../components/ui';
import { useApp } from '../lib/app-context';
import { ADMIN_TERMS, FAQ, GLOSSARY, HELP } from '../lib/glossary';
import { useTheme } from '../lib/theme';

const GUIDES = [['plan', 'route', 'Trip Planner'], ['prices', 'fuel', 'Fuel prices'], ['watch', 'trend', 'Price Watch'], ['stations', 'pin', 'Nearby stations'], ['news', 'news', 'Fuel news'], ['garage', 'car', 'My Garage']];
const SOURCES = [
  ['DOE price reports', 'Weekly pump prices and adjustment notices (PDFs, read automatically)'],
  ['OSRM · Photon · Nominatim', 'Routes, place search and addresses'],
  ['Open-Meteo', 'Weather and elevation along your route'],
  ['OpenStreetMap (Overpass)', 'Fuel station locations'],
  ['EIA / FRED · Frankfurter', 'Brent crude and the USD/PHP rate'],
  ['Google News RSS · PH outlets · GDELT', 'Fuel headlines'],
  ['Google Gemini', 'Understands your question and phrases the answer'],
];

function Faq({ q, a }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} style={{ borderBottomWidth: 1, borderColor: t.border, paddingVertical: 10, gap: 4 }}>
      <Row between><Txt bold style={{ flex: 1 }}>{q}</Txt><Icon name={open ? 'up' : 'down'} color={t.faint} /></Row>
      {open ? <Txt variant="small" tone="muted">{a}</Txt> : null}
    </Pressable>
  );
}

export default function Help() {
  const t = useTheme();
  const { resetOnboarding } = useApp();
  const [guide, setGuide] = useState(null);
  const h = guide ? HELP[guide] : null;
  return (
    <Screen>
      <PageHeader back title="Help" subtitle="Quick answers, the words we use, and how TipidLitro works." />
      <Card tone="welcome">
        <Txt variant="h3">New here?</Txt>
        <Txt tone="muted">See the short intro again, or just ask the assistant (orange chat button). Every screen also has a ? button that explains it.</Txt>
        <Row wrap gap={6}>
          <Btn small variant="primary" title="Show the intro again" onPress={() => { resetOnboarding(); router.navigate('/'); }} />
          <Btn small icon="chat" title="Ask a question" onPress={() => router.push('/chat')} />
        </Row>
      </Card>

      <Section title="How to use each screen" icon="help">
        <Row wrap gap={8}>
          {GUIDES.map(([k, icon, label]) => (
            <Pressable key={k} onPress={() => setGuide(k)} style={{ flexBasis: '46%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface2 }}>
              <Icon name={icon} color={t.brandStrong} /><Txt variant="small" bold>{label}</Txt>
            </Pressable>
          ))}
        </Row>
      </Section>

      <Section title="Frequently asked questions" icon="info">
        {FAQ.map(([q, a]) => <Faq key={q} q={q} a={a} />)}
      </Section>

      <Section title="Words you will see" icon="news" collapsible defaultOpen={false}>
        {Object.entries(GLOSSARY).filter(([k]) => !ADMIN_TERMS.includes(k)).map(([k, [term, def]]) => (
          <View key={k}><Txt bold>{term}</Txt><Txt variant="small" tone="muted">{def}</Txt></View>
        ))}
      </Section>

      <Section title="Where the data comes from" icon="server" collapsible defaultOpen={false}>
        {SOURCES.map(([name, what]) => <View key={name}><Txt variant="small" bold>{name}</Txt><Txt variant="small" tone="muted">{what}</Txt></View>)}
        <Txt variant="small" tone="muted">The TipidLitro server collects all of this on a schedule (DOE every hour), keeps it in one database, and this app reads it through the same REST API as the website.</Txt>
      </Section>

      <Section title="The trip estimate" icon="fuel" collapsible defaultOpen={false}>
        {[
          'OSRM returns up to 3 routes with distance, free-flow time, and expressway / toll / ferry segments.',
          'Your starting point\'s city and region pick the DOE price: your city\'s common price in NCR, or your region\'s report elsewhere.',
          'Elevation along each route adds fuel for climbing and credits some back downhill.',
          'Weather at your departure hour adds a wet-road penalty and head/tailwind effect.',
          'Traffic, aircon, passengers, cargo and driving style adjust km/L.',
          'Liters × price per liter = pesos. Every adjustment is listed under "Why this cost".',
        ].map((s, i) => <Row key={i} align="flex-start" gap={8}><Txt tone="brand" bold>{i + 1}.</Txt><Txt variant="small" style={{ flex: 1 }}>{s}</Txt></Row>)}
      </Section>

      <Section title="SDG 11 — Sustainable cities" icon="leaf" collapsible defaultOpen={false}>
        <Txt variant="small">Knowing what a trip really costs helps commuters, riders and delivery workers budget, pick cheaper routes and stations, carpool (cost split), and see the CO₂ of each trip.</Txt>
      </Section>

      <Section title="Limits" icon="alert" collapsible defaultOpen={false}>
        {[
          'DOE prices are weekly monitoring results; individual stations can price differently.',
          'Regional (non-NCR) prices come from field office reports and are labelled as estimates.',
          'Toll fees are not computed automatically (enter them under More options); ferry fares are not included.',
          'Electricity for EVs uses a typical residential rate (editable).',
          'History before 2019 has NCR-wide prices only.',
          'The price forecast is indicative: it uses Brent crude as a free stand-in for Singapore product prices (MOPS).',
        ].map((s) => <Row key={s} align="flex-start" gap={8}><Txt tone="muted">•</Txt><Txt variant="small" style={{ flex: 1 }}>{s}</Txt></Row>)}
      </Section>

      <Sheet visible={Boolean(h)} onClose={() => setGuide(null)} title={h?.title || ''}>
        {h ? (
          <>
            <Txt>{h.intro}</Txt>
            {h.steps?.map((s, i) => <Row key={i} align="flex-start" gap={8}><Txt tone="brand" bold>{i + 1}.</Txt><Txt style={{ flex: 1 }}>{s}</Txt></Row>)}
            {h.terms?.length ? h.terms.map((k) => <View key={k}><Txt bold>{GLOSSARY[k][0]}</Txt><Txt variant="small" tone="muted">{GLOSSARY[k][1]}</Txt></View>) : null}
            <Btn title="Got it" variant="primary" block onPress={() => setGuide(null)} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
