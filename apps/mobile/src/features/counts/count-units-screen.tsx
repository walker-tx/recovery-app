import type { FunctionReturnType } from 'convex/server';
import { api } from '@recovery/backend/convex/_generated/api';
import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { useConvex, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/radio-group';
import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
import { CountQueryBoundary } from './count-query-boundary';
import { canSaveUnit } from './count-reading';
import type { LargestUnit } from './elapsed-policy';

export function CountUnitsScreen({ id }: { id: Id<'counts'> }) {
  const router = useRouter();
  return <Screen contentClassName="justify-start" contentContainerStyle={{ paddingHorizontal: 20 }}><CountQueryBoundary key={id} message="This Count couldn’t be loaded. Try again or cancel." recovery={<Button variant="ghost" onPress={() => router.back()}>Cancel</Button>}><UnitsContent id={id} /></CountQueryBoundary></Screen>;
}
function UnitsContent({ id }: { id: Id<'counts'> }) {
  const router = useRouter();
  const count = useQuery(api.counts.get, { id });
  if (count === undefined) return <><Button variant="ghost" onPress={() => router.back()}>Cancel</Button><ActivityIndicator accessibilityLabel="Loading units" /></>;
  return <UnitsForm key={id} count={count} />;
}
function UnitsForm({ count }: { count: FunctionReturnType<typeof api.counts.get> }) {
  const [selected, setSelected] = useState<LargestUnit>(count.unit);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const router = useRouter();
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const setUnit = useMutation(api.counts.setUnit);
  usePreventRemove(pending, () => {});
  useEffect(() => { if (saved) router.back(); }, [saved, router]);
  async function save() {
    if (submitting.current || !canSaveUnit(count.unit, selected, convex.connectionState().isWebSocketConnected, pending)) return;
    submitting.current = true; setPending(true); setError(null);
    try { await setUnit({ id: count._id, unit: selected }); setSaved(true); }
    catch { setError('Units couldn’t be saved. Your previous setting is unchanged. Try again.'); }
    finally { submitting.current = false; setPending(false); }
  }
  return <>
    <View className="flex-row items-center justify-between">
      <Button variant="ghost" disabled={pending || saved} onPress={() => router.back()}>Cancel</Button>
      <Typography accessibilityRole="header" variant="overline">UNITS</Typography>
      <Button variant="ghost" disabled={saved || !canSaveUnit(count.unit, selected, connection.isWebSocketConnected, pending)} onPress={() => void save()}>{pending ? 'Saving…' : 'Done'}</Button>
    </View>
    <RadioGroup.Root label="Largest unit" value={selected} disabled={pending || saved} onValueChange={(value) => setSelected(value as LargestUnit)}>
      {(['hours', 'days', 'weeks', 'months', 'years'] as const).map((unit) => <RadioGroup.Item key={unit} value={unit} className="border-b border-line">{unit[0].toUpperCase() + unit.slice(1)}</RadioGroup.Item>)}
    </RadioGroup.Root>
    <Typography variant="caption">Sets the largest unit this Count uses. Everything above it rolls into it, everything below it still shows, down to minutes. Days by default.</Typography>
    {!connection.isWebSocketConnected ? <Typography accessibilityLiveRegion="polite">{pending ? 'Waiting for connection to finish saving.' : 'Connect to save. Your selection is still here.'}</Typography> : null}
    {error ? <Typography accessibilityRole="alert">{error}</Typography> : null}
  </>;
}
