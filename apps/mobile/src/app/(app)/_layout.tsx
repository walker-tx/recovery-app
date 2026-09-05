import { CountClockProvider } from '@/features/counts/count-clock';
import { Stack } from 'expo-router/stack';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  return <CountClockProvider><Stack screenOptions={{ headerShown: false }}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="counts/new" options={{ presentation: 'fullScreenModal' }} />
    <Stack.Screen name="counts/[id]/edit" options={{ presentation: 'fullScreenModal' }} />
    <Stack.Screen name="counts/[id]/units" options={{ presentation: 'fullScreenModal' }} />
  </Stack></CountClockProvider>;
}
