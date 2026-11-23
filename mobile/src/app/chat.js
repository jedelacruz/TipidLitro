// "Ask TipidLitro" assistant (port of public/js/chat.js): English/Taglish questions about trips,
// budgets and prices, answered from TipidLitro data (Gemini when configured).
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, Chip, Icon, IconButton, Row, Txt } from '../components/ui';
import { api, prefs } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useTheme } from '../lib/theme';

const SUGGESTIONS = [
  'Magkano from Cubao to Tagaytay by Vios?',
  '₱300 budget sa Click 125, gaano kalayo?',
  'Diesel price in Quezon City?',
  'Will gas go up next week?',
  'Bakit tumataas ang presyo ng diesel?',
  'Vios vs Click vs jeepney for 40 km',
  'Worth it ba 3 km away for ₱2 cheaper per liter, 30 liters?',
];
const GREETING = 'Hi! 👋 Ask me in English or Taglish:\n• trip fuel cost ("Magkano from Cubao to Tagaytay?")\n• how far a budget goes\n• DOE pump prices and next week\'s rollback/hike\n• why prices are moving';

/** Inline **bold** and [links](https://…) inside one line. */
function Inline({ text, color, linkColor }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <Text key={i} style={{ fontWeight: '700', color }}>{p.slice(2, -2)}</Text>;
    const m = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (m) return <Text key={i} style={{ color: linkColor, textDecorationLine: 'underline' }} onPress={() => Linking.openURL(m[2])}>{m[1]}</Text>;
    return <Text key={i} style={{ color }}>{p}</Text>;
  });
}
/** Just enough Markdown for the assistant's replies: paragraphs, bullets, bold, links. */
function Markdown({ text, color, linkColor }) {
  const lines = String(text).split('\n');
  return (
    <View style={{ gap: 3 }}>
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        if (heading) return <Text key={i} style={{ fontWeight: '800', fontSize: 15, color }}>{heading[1]}</Text>;
        return bullet ? (
          <View key={i} style={{ flexDirection: 'row', gap: 6 }}><Text style={{ color }}>•</Text><Text style={{ flex: 1, fontSize: 15, lineHeight: 21 }}><Inline text={bullet[1]} color={color} linkColor={linkColor} /></Text></View>
        ) : <Text key={i} style={{ fontSize: 15, lineHeight: 21 }}><Inline text={line} color={color} linkColor={linkColor} /></Text>;
      })}
    </View>
  );
}

export default function Chat() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { location, user } = useApp();
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('Answers from TipidLitro data');
  const scroll = useRef(null);

  useEffect(() => { prefs.get('chat', []).then((h) => setHistory(h.slice(-20))); }, []);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); }, [history, busy]);

  const plannerVehicle = async () => {
    const key = await prefs.get('vehicleKey', null);
    if (!key) return undefined;
    const [kind, id] = key.split(':');
    if (kind === 'preset') return { presetSlug: id };
    if (kind === 'uv') return { userVehicleId: Number(id) };
    return undefined;
  };

  const send = async (text) => {
    const msg = String(text || '').trim();
    if (!msg || busy) return;
    setInput(''); setBusy(true);
    const next = [...history, { role: 'user', text: msg }];
    setHistory(next);
    let reply;
    try {
      const res = await api('/chat', { method: 'POST', body: { message: msg, history: next.slice(-7, -1), context: { location: location || undefined, vehicle: await plannerVehicle(), region: user?.homeRegion || undefined } } });
      reply = { role: 'assistant', text: res.reply, action: res.action };
      setProvider(res.provider?.startsWith('gemini') ? 'Gemini · answers from TipidLitro data' : 'Offline mode (no Gemini key) · TipidLitro data');
    } catch (e) { reply = { role: 'assistant', text: `Sorry — ${e.message}` }; }
    const done = [...next, reply].slice(-20);
    setHistory(done); prefs.set('chat', done); setBusy(false);
  };

  const openTrip = (p) => {
    const enc = (x) => `${x[0]},${x[1]},${x[2] || ''}`;
    router.navigate({ pathname: '/', params: { o: enc(p.o), d: enc(p.d), ...(p.v ? { v: p.v } : {}), ...(p.k ? { k: String(p.k) } : {}), ...(p.rt ? { rt: '1' } : {}), t: String(Date.now()) } });
  };

  const bubble = (m, i) => {
    const mine = m.role === 'user';
    return (
      <View key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', backgroundColor: mine ? t.brandStrong : t.surface, borderWidth: mine ? 0 : 1, borderColor: t.border, borderRadius: 16, borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4, padding: 11, gap: 8 }}>
        {mine ? <Text style={{ color: t.brandInk, fontSize: 15 }}>{m.text}</Text> : <Markdown text={m.text} color={t.text} linkColor={t.brandStrong} />}
        {m.action?.type === 'open_trip' ? <Btn small icon="route" title="Open in Trip Planner" onPress={() => openTrip(m.action.params)} /> : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Row style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: t.border }}>
        <Pressable hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}><Icon name="back" size={28} /></Pressable>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.brandStrong, alignItems: 'center', justifyContent: 'center' }}><Icon name="fuel" color={t.brandInk} /></View>
        <View style={{ flex: 1 }}><Txt bold>TipidLitro Assistant</Txt><Txt variant="tiny" tone="muted">{provider}</Txt></View>
        <IconButton icon="trash" label="Clear conversation" onPress={() => { setHistory([]); prefs.set('chat', []); }} />
      </Row>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }} keyboardShouldPersistTaps="handled">
          {!history.length ? bubble({ role: 'assistant', text: GREETING }, 'hi') : null}
          {history.map(bubble)}
          {busy ? <View style={{ alignSelf: 'flex-start', backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}><Txt tone="muted">Thinking…</Txt></View> : null}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
          {SUGGESTIONS.map((s) => <Chip key={s} label={s} onPress={() => send(s)} />)}
        </ScrollView>
        <Row style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.surface }}>
          <TextInput value={input} onChangeText={setInput} placeholder="Ask about a trip, budget or prices…" placeholderTextColor={t.faint} maxLength={500} returnKeyType="send" onSubmitEditing={() => send(input)}
            style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 14, color: t.text, backgroundColor: t.bg, fontSize: 15 }} />
          <Pressable accessibilityLabel="Send" onPress={() => send(input)} disabled={busy || !input.trim()} style={{ width: 44, height: 44, borderRadius: 99, backgroundColor: t.brandStrong, alignItems: 'center', justifyContent: 'center', opacity: busy || !input.trim() ? 0.5 : 1 }}>
            <Icon name="send" color={t.brandInk} />
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
    </View>
  );
}
