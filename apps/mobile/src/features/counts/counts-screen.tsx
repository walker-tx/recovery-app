import { api } from '@recovery/backend/convex/_generated/api';
import { usePaginatedQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
import { countsView } from './count-form-policy';
import { CountQueryBoundary } from './count-query-boundary';

export function CountsScreen() {
  return <Screen contentClassName="justify-start">
    <Typography accessibilityRole="header" variant="display">Counts</Typography>
    <CountQueryBoundary message="Counts couldn’t be loaded. Try again."><CountsContent /></CountQueryBoundary>
  </Screen>;
}

function CountsContent() {
  const router = useRouter();
  const { results, status, loadMore } = usePaginatedQuery(api.counts.list, {}, { initialNumItems: 25 });
  const view = countsView(status, results.length);
  if (view === 'loading') return <View accessibilityRole="progressbar" accessibilityLabel="Loading Counts"><ActivityIndicator /><Typography>Loading Counts…</Typography></View>;
  if (view === 'empty') return <View className="flex-1 justify-center gap-lg">
    <Typography variant="overline">NO COUNTS YET</Typography>
    <Typography accessibilityRole="header" variant="title">Track your sobriety.</Typography>
    <Typography>Counts keep track of sobriety from any unwanted substance or behavior. Name yours and give it a start date.</Typography>
    <Button onPress={() => router.push('/(app)/counts/new')}>Create your first Count</Button>
    <Typography className="text-center">Your Counts are private to you.</Typography>
    <Typography className="text-center">Create as many as you like.</Typography>
  </View>;
  return <View className="gap-lg">
    <Button onPress={() => router.push('/(app)/counts/new')}>Add Count</Button>
    {results.map((count) => <View key={count._id} className="gap-sm border-b border-line py-md">
      <Typography variant="title">{count.name}</Typography>
      <Typography variant="caption">Started {new Date(count.startAt).toLocaleDateString()}</Typography>
    </View>)}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button variant="secondary" disabled={status === 'LoadingMore'} onPress={() => loadMore(25)}>{status === 'LoadingMore' ? 'Loading…' : 'Load more'}</Button> : null}
  </View>;
}
