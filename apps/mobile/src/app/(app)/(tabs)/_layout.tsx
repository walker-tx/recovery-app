import { Tabs } from 'expo-router/tabs';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  return <Tabs initialRouteName="home" screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarStyle: { backgroundColor: colors.canvas }, tabBarIconStyle: { display: 'none' }, tabBarLabelStyle: { fontSize: 14 } }}>
    <Tabs.Screen name="home" options={{ title: 'Counts' }} />
    <Tabs.Screen name="today" options={{ title: 'Today' }} />
    <Tabs.Screen name="read" options={{ title: 'Read' }} />
    <Tabs.Screen name="you" options={{ title: 'You' }} />
  </Tabs>;
}
