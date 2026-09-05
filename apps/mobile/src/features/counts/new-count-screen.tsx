import { api } from '@recovery/backend/convex/_generated/api';
import { useConvex, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
import { CountForm } from './count-form';
import { CountFormHeader } from './count-form-header';
import { canSaveCount, countNameError, duplicateNotice, EMPTY_COUNT_DRAFT, isCountDraftDirty } from './count-form-policy';
import { CountQueryBoundary } from './count-query-boundary';

function DuplicateNotice({ name }: { name: string }) {
  const duplicate = useQuery(api.counts.findDuplicate, countNameError(name) === null ? { name: name.trim() } : 'skip');
  const notice = duplicateNotice(duplicate);
  return notice ? <Typography accessibilityLiveRegion="polite" variant="caption">{notice}</Typography> : null;
}

export function NewCountScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const create = useMutation(api.counts.create);
  const [draft, setDraft] = useState(EMPTY_COUNT_DRAFT);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  usePreventRemove(!saved && (pending || isCountDraftDirty(draft, EMPTY_COUNT_DRAFT)), ({ data }) => {
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
    if (submitting.current || !canSaveCount(draft, convex.connectionState().isWebSocketConnected, pending)) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await create({ name: draft.name.trim(), startAt: draft.startAt! });
      setSaved(true);
    } catch {
      setError('Your Count couldn’t be saved. Your changes are still here. Try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return <Screen contentClassName="justify-start" contentContainerStyle={{ paddingHorizontal: 20 }} automaticallyAdjustKeyboardInsets>
    <CountFormHeader title="New Count" cancelDisabled={pending || saved}
      saveDisabled={saved || !canSaveCount(draft, connection.isWebSocketConnected, pending)} pending={pending}
      onCancel={() => router.back()} onSave={() => void save()} />
    <CountForm draft={draft} onChange={setDraft} disabled={pending || saved} nameNotice={
      <CountQueryBoundary message="Duplicate names couldn’t be checked. You can still save.">
        <DuplicateNotice name={draft.name} />
      </CountQueryBoundary>
    } />
    {!connection.isWebSocketConnected ? <Typography accessibilityLiveRegion="polite">{pending ? 'Waiting for connection to finish saving. Your draft is still here.' : 'Connect to save. Your draft is still here.'}</Typography> : null}
    {error ? <Typography accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Typography> : null}
  </Screen>;
}
