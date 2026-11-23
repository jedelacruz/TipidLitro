// Root layout: app state, theme, status bar, sign-in sheet, toasts and the first-run intro.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Onboarding from '../components/Onboarding';
import { AuthSheet } from '../components/shared';
import { ToastHost } from '../components/ui';
import { AppProvider, useApp } from '../lib/app-context';
import { ThemeContext } from '../lib/theme';

function Shell() {
  const { theme, ready, onboarded } = useApp();
  useEffect(() => { SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {}); }, [theme]);
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#ea580c', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800' }}>Tipid<Text style={{ color: '#fff4dc' }}>Litro</Text></Text>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <ThemeContext.Provider value={theme}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
      <AuthSheet />
      <ToastHost />
      {!onboarded ? <Onboarding /> : null}
    </ThemeContext.Provider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
