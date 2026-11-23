// Fuel news (port of public/js/views/news.js): headlines tagged by topic, with the ▲/▼ pressure gauge.
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { AlertBox, Card, Chip, Empty, Gauge, Loading, PageHeader, Row, Screen, Txt, toast } from '../components/ui';
import { api } from '../lib/api';
import { fmt } from '../lib/format';
import { useTheme } from '../lib/theme';

const DIR = { up: ['▲', 'upward pressure'], down: ['▼', 'downward pressure'], mixed: ['◆', 'mixed'], neutral: ['•', 'neutral'] };

export default function News() {
  const t = useTheme();
  const [category, setCategory] = useState('');
  const [d, setD] = useState(null);
  const [cats, setCats] = useState(null);
  const [pressure, setPressure] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await api(`/news?limit=80${category ? `&category=${category}` : ''}`);
      setD(res);
      if (!cats) setCats(res.categories);
      if (!category) setPressure(res.pressure);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const p = pressure; const tot = p ? p.up + p.down : 0;
  return (
    <Screen onRefresh={load} refreshing={false}>
      <PageHeader back title="Fuel news" help="news" subtitle="Why are prices moving? Oil supply, conflict, taxes and the peso — refreshed hourly." />
      {p ? (
        <Card>
          <Row between><Txt variant="h3">Headline pressure, 7 days</Txt></Row>
          <Txt variant="small" tone="muted">{p.up} point up · {p.down} point down · {p.mixed} mixed</Txt>
          <Gauge up={p.up} down={p.down} />
          <Txt variant="small" tone="muted">{tot ? (p.score > 0.2 ? 'More headlines point to higher prices.' : p.score < -0.2 ? 'More headlines point to lower prices.' : 'Headlines are balanced.') : 'Not enough tagged headlines yet.'}</Txt>
        </Card>
      ) : null}
      {cats ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[['', 'All'], ...Object.entries(cats)].map(([k, label]) => <Chip key={k} label={label} on={k === category} onPress={() => setCategory(k)} />)}
        </ScrollView>
      ) : null}
      {error ? <AlertBox level="danger" text={error} /> : null}
      {busy && !d ? <Loading /> : null}
      {d && !d.items.length ? <Empty icon="📰" title="No headlines yet" text="The news job runs hourly." /> : null}
      {d?.items.map((n) => {
        const [sym, label] = DIR[n.direction] || DIR.neutral;
        const ok = /^https?:\/\//i.test(n.url);
        return (
          <Pressable key={n.id ?? n.url} disabled={!ok} onPress={() => WebBrowser.openBrowserAsync(n.url).catch(() => toast('Could not open the article', 'error'))}>
            <Card>
              <Txt bold>{n.title}</Txt>
              {n.summary && n.summary !== n.title ? <Txt variant="small" tone="muted" numberOfLines={3}>{n.summary.slice(0, 200)}</Txt> : null}
              <Row wrap gap={6}>
                <Txt variant="tiny" tone="faint">{n.source || n.provider} · {fmt.ago(n.published_at)}</Txt>
                <Txt variant="tiny" bold tone={n.direction === 'up' ? 'up' : n.direction === 'down' ? 'down' : 'muted'}>{sym} {label}</Txt>
              </Row>
              {n.categories?.length ? <Row wrap gap={4}>{n.categories.map((c) => <View key={c} style={{ backgroundColor: t.surface2, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}><Txt variant="tiny" tone="muted">{(cats || d.categories)[c] || c}</Txt></View>)}</Row> : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
