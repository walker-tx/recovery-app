import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { api } from '@recovery/backend/convex/_generated/api';
import { useConvex, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
import { CountForm } from './count-form';
import { canSaveCountEdit, countDuplicateArgs, duplicateNotice, editCountDraft, isCountDraftDirty, type CountDraft } from './count-form-policy';
import { CountQueryBoundary } from './count-query-boundary';

function DuplicateNotice({ name, id }: { name: string; id: Id<'counts'> }) {
  const duplicate = useQuery(api.counts.findDuplicate, countDuplicateArgs(name, id));
  const notice = duplicateNotice(duplicate);
  return notice ? <Typography accessibilityLiveRegion="polite" variant="caption">{notice}</Typography> : null;
}

export function EditCountScreen({ id }: { id: Id<'counts'> }) {
  return <EditCountForm key={id} id={id} />;
}

// A failed/retrying subscription replaces only this subtree, not the draft owner.
// Cached draft values never bypass the live query or the mutation's ownership check.
function LoadedEditCount({ id, onInitialize, children }: { id: Id<'counts'>; onInitialize: (count: CountDraft) => void; children: ReactNode }) {
  const count = useQuery(api.counts.get, { id });
  useEffect(() => { if (count !== undefined) onInitialize(count); }, [count, onInitialize]);
  return count === undefined ? <Screen><Typography>Loading Count…</Typography></Screen> : children;
}
function EditCountForm({ id }: { id: Id<'counts'> }) {
  const router = useRouter();
  const navigation = useNavigation();
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const edit = useMutation(api.counts.edit);
  const [original, setOriginal] = useState<CountDraft | null>(null);
  const [draft, setDraft] = useState<CountDraft | null>(null);
  const initialize = useCallback((count: CountDraft) => {
    setOriginal((previous) => previous ?? count);
    setDraft((previous) => previous ?? count);
  }, []);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  usePreventRemove(!saved && (pending || (draft !== null && original !== null && isCountDraftDirty(draft, original))), ({ data }) => {
    if (submitting.current) {
      Alert.alert('Saving Count', 'Please wait while your save completes. Your draft is still here.');
      return;
    }
    Alert.alert('Discard changes?', 'Your changes haven’t been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => { if (saved) router.back(); }, [saved, router]);

  async function save() {
    if (!draft || !original || submitting.current || !canSaveCountEdit(draft, original, convex.connectionState().isWebSocketConnected, pending)) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await edit({ id, name: draft.name.trim(), startAt: draft.startAt! });
      setSaved(true);
    } catch {
      setError('Your Count couldn’t be saved. Your changes are still here. Try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <CountQueryBoundary recovery={<Button variant="secondary" onPress={() => router.replace('/(app)/(tabs)/home')}>Counts</Button>} message="This Count couldn’t be loaded. It may have been deleted. Try again or return to Counts.">
    <LoadedEditCount id={id} onInitialize={initialize}>
    {draft && original ? <Screen contentClassName="justify-start" automaticallyAdjustKeyboardInsets>
    <View className="flex-row justify-between gap-md">
      <Button variant="secondary" disabled={pending || saved} onPress={() => router.back()}>Cancel</Button>
      <Button disabled={saved || !canSaveCountEdit(draft, original, connection.isWebSocketConnected, pending)} accessibilityState={{ busy: pending }} onPress={() => void save()}>{pending ? 'Saving…' : 'Save'}</Button>
    </View>
    <Typography accessibilityRole="header" variant="display">Edit Count</Typography>
    <CountForm draft={draft} onChange={(next) => setDraft(editCountDraft(next, original))} disabled={pending || saved} nameNotice={
      <CountQueryBoundary message="Duplicate names couldn’t be checked. You can still save.">
        <DuplicateNotice name={draft.name} id={id} />
      </CountQueryBoundary>
    } />
    {!connection.isWebSocketConnected ? <Typography accessibilityLiveRegion="polite">{pending ? 'Waiting for connection to finish saving. Your draft is still here.' : 'Connect to save. Your draft is still here.'}</Typography> : null}
    {error ? <Typography accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Typography> : null}
  </Screen> : null}
    </LoadedEditCount>
  </CountQueryBoundary>;
}
