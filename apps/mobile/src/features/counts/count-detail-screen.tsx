import { api } from '@recovery/backend/convex/_generated/api';
import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { useConvexConnectionState, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
import { CountQueryBoundary } from './count-query-boundary';
import { countsOfflineNotice } from './count-form-policy';
import { useCountNow } from './count-clock';
import { CountReading, MilestoneBadge } from './count-presentation';
import { formatStarted } from './count-reading';
import { latestMilestone } from './elapsed-policy';

export function CountDetailScreen({ id }: { id: Id<'counts'> }) {
  const router = useRouter();
  return <Screen contentClassName="justify-start" contentContainerStyle={{ paddingHorizontal: 20 }}>
    <View className="flex-row justify-between"><Button variant="ghost" onPress={() => router.replace('/(app)/(tabs)/home')}>‹ Counts</Button>{/* #11: overflow Edit/Delete belongs here. */}</View>
    <CountQueryBoundary key={id} message="This Count couldn’t be loaded. It may have been deleted. Try again or return to Counts."><CountDetailContent id={id} /></CountQueryBoundary>
  </Screen>;
}
function CountDetailContent({ id }: { id: Id<'counts'> }) {
  const count = useQuery(api.counts.get, { id });
  const connection = useConvexConnectionState();
  const now = useCountNow();
  const router = useRouter();
  if (count === undefined) return <View accessibilityRole="progressbar" accessibilityLabel="Loading Count"><ActivityIndicator /><Typography>Loading Count…</Typography></View>;
  const offlineNotice = countsOfflineNotice('loaded', connection.isWebSocketConnected);
  const milestone = latestMilestone(count.startAt, now);
  return <View style={{ gap: 22 }}>
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <View className="border border-line" style={{ padding: 16, gap: 10 }}>
      {([{ top: -6, left: -6 }, { top: -6, right: -6 }, { bottom: -6, left: -6 }, { bottom: -6, right: -6 }]).map((position, index) => <View key={index} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', width: 11, height: 11, ...position }}><View className="bg-ink-muted" style={{ position: 'absolute', left: 5, width: 1, height: 11 }} /><View className="bg-ink-muted" style={{ position: 'absolute', top: 5, height: 1, width: 11 }} /></View>)}
      <Typography variant="overline">COUNT</Typography>
      <Typography accessibilityRole="header" style={{ fontSize: 27, fontWeight: '600' }}>{count.name}</Typography>
      <CountReading count={count} now={now} size="detail" />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Units, ${count.unit}`} onPress={() => router.push({ pathname: '/(app)/counts/[id]/units', params: { id } })} className="min-h-touch flex-row items-center justify-between border-y border-line py-md">
      <Typography variant="overline">UNITS</Typography><Typography className="text-blueprint">{count.unit[0].toUpperCase() + count.unit.slice(1)} ›</Typography>
    </Pressable>
    <View style={{ gap: 11 }}>
      {milestone ? <View className="flex-row items-center justify-between gap-sm"><Typography variant="overline">LATEST MILESTONE</Typography><MilestoneBadge milestone={milestone} /></View> : null}
      <View style={{ gap: 3 }}><Typography variant="overline">STARTED</Typography><Typography>{formatStarted(count.startAt, true)}</Typography></View>
    </View>
    {/* #11 adds the sole outlined Edit bottom rail; no fake action before then. */}
  </View>;
}
