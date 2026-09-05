import { api } from '@recovery/backend/convex/_generated/api';
import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { useConvex, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { usePreventRemove } from 'expo-router/react-navigation';
import { CountOverflow } from './count-overflow';
import { deleteCountOnce } from './count-form-policy';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
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
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const remove = useMutation(api.counts.remove);
  const submitting = useRef(false);
  const confirming = useRef(false);
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePreventRemove(pending && !deleted, () => {
    Alert.alert('Deleting Count', 'Please wait while deletion completes.');
  });
  useEffect(() => { if (deleted) router.replace('/(app)/(tabs)/home'); }, [deleted, router]);
  function confirmDelete(count: { name: string; startAt: number }) {
    if (submitting.current || confirming.current || deleted) return;
    if (!convex.connectionState().isWebSocketConnected) {
      setError('Connect to delete this Count.');
      return;
    }
    confirming.current = true;
    Alert.alert('Delete Count?', `“${count.name}”, started ${new Date(count.startAt).toLocaleDateString()}, will be permanently deleted. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'Delete', style: 'destructive', onPress: () => {
        confirming.current = false;
        void deleteCount();
      } },
    ], { cancelable: false });
  }
  async function deleteCount() {
    if (submitting.current || deleted) return;
    if (!convex.connectionState().isWebSocketConnected) { setError('Connect to delete this Count.'); return; }
    setPending(true);
    setError(null);
    const result = await deleteCountOnce(submitting, convex.connectionState().isWebSocketConnected, () => remove({ id }));
    if (result === 'deleted') setDeleted(true);
    if (result === 'failed') setError('We couldn’t delete this Count. Please try again.');
    setPending(false);
  }
  return <Screen contentClassName="justify-start" contentContainerStyle={{ paddingHorizontal: 20 }}>
    <CountQueryBoundary key={id} recovery={<Button variant="ghost" disabled={pending || deleted} onPress={() => router.replace('/(app)/(tabs)/home')}>‹ Counts</Button>} message="This Count couldn’t be loaded. It may have been deleted. Try again or return to Counts."><CountDetailContent id={id} disabled={pending || deleted} onDelete={confirmDelete} /></CountQueryBoundary>
    {pending ? <Typography accessibilityLiveRegion="polite">{connection.isWebSocketConnected ? 'Deleting Count…' : 'Waiting for connection to finish deleting.'}</Typography> : null}
    {error ? <Typography accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Typography> : null}
  </Screen>;
}
function CountDetailContent({ id, disabled, onDelete }: { id: Id<'counts'>; disabled: boolean; onDelete: (count: { name: string; startAt: number }) => void }) {
  const count = useQuery(api.counts.get, { id });
  const connection = useConvexConnectionState();
  const now = useCountNow();
  const router = useRouter();
  if (count === undefined) return <View accessibilityRole="progressbar" accessibilityLabel="Loading Count"><ActivityIndicator /><Typography>Loading Count…</Typography></View>;
  const offlineNotice = countsOfflineNotice('loaded', connection.isWebSocketConnected);
  const edit = () => { if (!disabled) router.push({ pathname: '/(app)/counts/[id]/edit', params: { id } }); };
  const milestone = latestMilestone(count.startAt, now);
  return <View style={{ gap: 22, flexGrow: 1 }}>
    <View className="flex-row items-center justify-between"><Button variant="ghost" disabled={disabled} onPress={() => router.replace('/(app)/(tabs)/home')}>‹ Counts</Button><CountOverflow disabled={disabled} onEdit={edit} onDelete={() => onDelete(count)} /></View>
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <View className="border border-line" style={{ padding: 16, gap: 10 }}>
      {([{ top: -6, left: -6 }, { top: -6, right: -6 }, { bottom: -6, left: -6 }, { bottom: -6, right: -6 }]).map((position, index) => <View key={index} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', width: 11, height: 11, ...position }}><View className="bg-ink-muted" style={{ position: 'absolute', left: 5, width: 1, height: 11 }} /><View className="bg-ink-muted" style={{ position: 'absolute', top: 5, height: 1, width: 11 }} /></View>)}
      <Typography variant="overline">COUNT</Typography>
      <Typography accessibilityRole="header" style={{ fontSize: 27, fontWeight: '600' }}>{count.name}</Typography>
      <CountReading count={count} now={now} size="detail" />
    </View>
    <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Units, ${count.unit}`} onPress={() => router.push({ pathname: '/(app)/counts/[id]/units', params: { id } })} className="min-h-touch flex-row items-center justify-between border-y border-line py-md">
      <Typography variant="overline">UNITS</Typography><Typography className="text-blueprint">{count.unit[0].toUpperCase() + count.unit.slice(1)} ›</Typography>
    </Pressable>
    <View style={{ gap: 11 }}>
      {milestone ? <View className="flex-row items-center justify-between gap-sm"><Typography variant="overline">LATEST MILESTONE</Typography><MilestoneBadge milestone={milestone} /></View> : null}
      <View style={{ gap: 3 }}><Typography variant="overline">STARTED</Typography><Typography>{formatStarted(count.startAt, true)}</Typography></View>
    </View>
    <View style={{ flexGrow: 1 }} /><Button variant="secondary" disabled={disabled} onPress={edit}>Edit</Button>
  </View>;
}
