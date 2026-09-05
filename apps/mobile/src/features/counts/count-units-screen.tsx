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
  // Authentication scope belongs to the protected app navigator.
  return <UnitsScope id={id} />;
}
function UnitsScope({ id }: { id: Id<'counts'> }) { return <UnitsOwner key={id} id={id} />; }
function UnitsOwner({ id }: { id: Id<'counts'> }) {
  const [selected, setSelected] = useState<LargestUnit | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const router = useRouter();
  usePreventRemove(pending, () => {});
  useEffect(() => { if (saved) router.back(); }, [saved, router]);
  const state = {selected, setSelected, pending, setPending, saved, setSaved, error, setError, submitting};
  return <Screen contentClassName="justify-start" contentContainerStyle={{ paddingHorizontal: 20 }}><CountQueryBoundary message="This Count couldn’t be loaded. Try again or cancel." recovery={<Button variant="ghost" disabled={pending} onPress={() => router.back()}>Cancel</Button>}><UnitsContent id={id} state={state} /></CountQueryBoundary></Screen>;
}
type UnitsState = {
  selected: LargestUnit | null; setSelected: (value: LargestUnit) => void;
  pending: boolean; setPending: (value: boolean) => void;
  saved: boolean; setSaved: (value: boolean) => void;
  error: string | null; setError: (value: string | null) => void;
  submitting: React.RefObject<boolean>;
};
function UnitsContent({ id, state }: { id: Id<'counts'>; state: UnitsState }) {
  const router = useRouter();
  const count = useQuery(api.counts.get, { id });
  if (count === undefined) return <><Button variant="ghost" disabled={state.pending} onPress={() => router.back()}>Cancel</Button><ActivityIndicator accessibilityLabel="Loading units" /></>;
  return <UnitsForm count={count} state={state} />;
}
function UnitsForm({ count, state }: { count: FunctionReturnType<typeof api.counts.get>; state: UnitsState }) {
  const {setSelected, pending, setPending, saved, setSaved, error, setError, submitting} = state;
  const selected = state.selected ?? count.unit;
  const router = useRouter();
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const setUnit = useMutation(api.counts.setUnit);
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
