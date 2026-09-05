import { Tabs } from 'expo-router/tabs';
import { Text } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

// The artifact uses these text glyphs, not SVGs; keep platform symbol fallback.
const icons: Record<string, string> = { home: '▤', today: '☰', read: '◫', you: '○' };

export default function TabsLayout() {
  return <Tabs initialRouteName="home" screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: colors.blueprint,
    tabBarInactiveTintColor: colors.inkMuted,
    // Native navigation owns bar height and safe-area insets, not the board crop.
    tabBarStyle: { backgroundColor: colors.canvas, borderTopColor: colors.line },
    tabBarItemStyle: { minHeight: 48 },
    tabBarLabelPosition: 'below-icon',
    tabBarAllowFontScaling: true,
    tabBarLabelStyle: {
      fontFamily: fonts.heading,
      fontWeight: 'normal',
      fontSize: 9.5,
      letterSpacing: 1.14,
      textTransform: 'uppercase',
    },
    tabBarIcon: ({ color }) => <Text accessible={false} importantForAccessibility="no" style={{ color, fontSize: 15 }}>{icons[route.name]}</Text>,
  })}>
    <Tabs.Screen name="home" options={{ title: 'Counts' }} />
    <Tabs.Screen name="today" options={{ title: 'Today' }} />
    <Tabs.Screen name="read" options={{ title: 'Read' }} />
    <Tabs.Screen name="you" options={{ title: 'You' }} />
  </Tabs>;
}
