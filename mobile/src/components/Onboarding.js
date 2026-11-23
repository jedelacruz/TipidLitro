// First-run intro (the app's version of the web welcome card + tour). Re-open from Help.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app-context';
import { useTheme } from '../lib/theme';
import { Btn, Icon, Txt } from './ui';

const SLIDES = [
  { icon: 'fuel', title: 'Welcome to TipidLitro', text: 'See how much fuel your trip will cost, based on this week\'s official DOE pump prices for your city.' },
  { icon: 'route', title: 'Plan a trip in 3 steps', text: '1. Where you\'re starting\n2. Where you\'re going\n3. Your vehicle — then tap Calculate.\n\nExtras like passengers, tolls and your plate number are optional.' },
  { icon: 'trend', title: 'Prices and next week', text: 'Check prices by city and brand back to 2017, and see if a rollback or hike is coming next Tuesday.' },
  { icon: 'pin', title: 'Cheapest station nearby', text: 'Compare stations by what you really pay — the fill-up plus the fuel to get there — then open Waze, Google Maps or Apple Maps.' },
  { icon: 'chat', title: 'Just ask', text: 'Tap the orange chat button and ask in English or Taglish, like "Magkano from Cubao to Tagaytay by Click?" Every screen also has a ? button that explains it.' },
];

export default function Onboarding() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { finishOnboarding } = useApp();
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
      <View style={{ alignItems: 'flex-end' }}><Pressable onPress={finishOnboarding} hitSlop={10}><Txt tone="muted" bold>Skip</Txt></Pressable></View>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18 }}>
        <View style={{ width: 110, height: 110, borderRadius: 30, backgroundColor: t.brandStrong, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={s.icon} size={56} color={t.brandInk} />
        </View>
        <Txt variant="h1" style={{ textAlign: 'center' }}>{s.title}</Txt>
        <Txt tone="muted" style={{ textAlign: 'center', fontSize: 16, lineHeight: 24 }}>{s.text}</Txt>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 18 }}>
        {SLIDES.map((_, k) => <View key={k} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 99, backgroundColor: k === i ? t.brandStrong : t.border }} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {i > 0 ? <Btn title="Back" onPress={() => setI(i - 1)} style={{ flex: 1 }} block /> : null}
        <Btn title={last ? 'Get started' : 'Next'} variant="primary" onPress={() => (last ? finishOnboarding() : setI(i + 1))} style={{ flex: 2 }} block />
      </View>
      <Text style={{ textAlign: 'center', color: t.faint, marginTop: 10, fontSize: 12 }}>Step {i + 1} of {SLIDES.length}</Text>
    </View>
  );
}
