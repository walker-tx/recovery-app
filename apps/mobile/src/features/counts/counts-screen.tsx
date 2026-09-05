import { api } from '@recovery/backend/convex/_generated/api';
import { usePaginatedQuery, useConvexConnectionState } from 'convex/react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
import { useCountNow } from './count-clock';
import { CountRow } from './count-presentation';
import { countsView, countsOfflineNotice } from './count-form-policy';
import { CountQueryBoundary } from './count-query-boundary';

export function CountsScreen() {
  return <Screen contentClassName="justify-start" contentContainerStyle={{ paddingHorizontal: 20 }}>
    <CountQueryBoundary message="Counts couldn’t be loaded. Try again."><CountsContent /></CountQueryBoundary>
  </Screen>;
}

function CountsContent() {
  const router = useRouter();
  const now = useCountNow();
  const { results, status, loadMore } = usePaginatedQuery(api.counts.list, {}, { initialNumItems: 25 });
  const connection = useConvexConnectionState();
  const offlineNotice = countsOfflineNotice(status, connection.isWebSocketConnected);
  const view = countsView(status, results.length);
  if (view === 'loading') return <View accessibilityRole="progressbar" accessibilityLabel="Loading Counts"><ActivityIndicator /><Typography>Loading Counts…</Typography></View>;
  if (view === 'empty') return <View className="flex-1 justify-center gap-lg">
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <Typography accessibilityRole="header" variant="display">Counts</Typography>
    <Typography variant="overline">NO COUNTS YET</Typography>
    <Typography accessibilityRole="header" variant="title">Track your sobriety.</Typography>
    <Typography>Counts keep track of sobriety from any unwanted substance or behavior. Name yours and give it a start date.</Typography>
    <Button onPress={() => router.push('/(app)/counts/new')}>Create your first Count</Button>
    <Typography className="text-center">Your Counts are private to you.</Typography>
    <Typography className="text-center">Create as many as you like.</Typography>
  </View>;
  return <View className="gap-lg">
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <View className="flex-row items-center justify-between">
      <View><Typography variant="overline">RECOVERY</Typography><Typography accessibilityRole="header" variant="display">Counts</Typography></View>
      {/* #15 adds the separate Reorder action here, never a dead control. */}
      <Button variant="ghost" accessibilityLabel="Add Count" onPress={() => router.push('/(app)/counts/new')}>＋</Button>
    </View>
    <View>{results.map((count) => <CountRow key={count._id} count={count} now={now} onPress={() => router.push({ pathname: '/(app)/counts/[id]', params: { id: count._id } })} />)}</View>
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button variant="secondary" disabled={status === 'LoadingMore'} onPress={() => loadMore(25)}>{status === 'LoadingMore' ? 'Loading…' : 'Load more'}</Button> : null}
  </View>;
}
