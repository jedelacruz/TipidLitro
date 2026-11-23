// Bottom tabs: the same five main sections as the web app's mobile navigation.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useTheme } from '../../lib/theme';

const icon = (name) => function TabIcon({ color, size }) { return <MaterialCommunityIcons name={name} color={color} size={size} />; };

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: t.brandStrong,
      tabBarInactiveTintColor: t.muted,
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
      tabBarLabelStyle: { fontWeight: '600' },
      sceneStyle: { backgroundColor: t.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Plan', tabBarIcon: icon('map-marker-path') }} />
      <Tabs.Screen name="prices" options={{ title: 'Prices', tabBarIcon: icon('gas-station') }} />
      <Tabs.Screen name="watch" options={{ title: 'Watch', tabBarIcon: icon('chart-line') }} />
      <Tabs.Screen name="stations" options={{ title: 'Stations', tabBarIcon: icon('map-marker-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('view-grid-outline') }} />
    </Tabs>
  );
}
