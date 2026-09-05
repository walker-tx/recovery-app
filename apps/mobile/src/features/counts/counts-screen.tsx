import { api } from '@recovery/backend/convex/_generated/api';
import { usePaginatedQuery, useConvexConnectionState, useMutation, useConvex } from 'convex/react';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, BackHandler, findNodeHandle, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { changedPositions, proposedOrder, reorderReducer } from './reorder-policy';
import { ReorderRows, type ScrollMetrics } from './reorder-rows';
import { Typography } from '@/components/ui/text';
import { useCountNow } from './count-clock';
import { CountRow } from './count-presentation';
import { countsView, countsOfflineNotice } from './count-form-policy';
import { CountQueryBoundary } from './count-query-boundary';

export function CountsScreen() {
  // The protected app navigator unmounts this owner on sign-out/account changes.
  return <CountsOwner />;
}

function CountsOwner() {
  const navigation = useNavigation();
  const [draft, dispatch] = useReducer(reorderReducer, null);
  const submitting = useRef(false);
  const dirty = useRef(false);
  function cancel() { if (!submitting.current) dispatch({type:'cancel'}); }
  function requestLeave(leave:()=>void) {
    if (submitting.current) return;
    if (!dirty.current) {cancel(); leave(); return;}
    Alert.alert('Discard changes?', 'Your changes haven’t been saved.', [
      {text:'Keep editing', style:'cancel'},
      {text:'Discard', style:'destructive', onPress:() => {cancel(); leave();}},
    ]);
  }
  usePreventRemove(draft !== null, ({data}) => requestLeave(() => navigation.dispatch(data.action)));
  useFocusEffect(useCallback(() => {
    if (!draft) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {requestLeave(() => {}); return true;});
    return () => subscription.remove();
  }, [draft]));
  return <SafeAreaView className="flex-1 bg-canvas" style={{paddingHorizontal:20}}>
    <CountQueryBoundary message="Counts couldn’t be loaded. Try again."><CountsContent draft={draft} dispatch={dispatch} submitting={submitting} dirty={dirty} /></CountQueryBoundary>
  </SafeAreaView>;
}

function CountsContent({draft, dispatch, submitting, dirty}: {draft: ReturnType<typeof reorderReducer>; dispatch: React.Dispatch<Parameters<typeof reorderReducer>[1]>; submitting: React.RefObject<boolean>; dirty: React.RefObject<boolean>}) {
  const router = useRouter();
  const now = useCountNow();
  const convex = useConvex();
  const reorder = useMutation(api.counts.reorder);
  const modeControl = useRef<View>(null);
  const wasReordering = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const metrics = useRef<ScrollMetrics>({offset:0, height:0, contentHeight:0});
  const { results, status, loadMore } = usePaginatedQuery(api.counts.list, {}, { initialNumItems: 25 });
  const connection = useConvexConnectionState();
  const offlineNotice = countsOfflineNotice(status, connection.isWebSocketConnected);
  const view = countsView(status, results.length);
  const serverIds = results.map(count => count._id);
  const orderedIds = draft ? proposedOrder(serverIds as string[], draft.ids) : serverIds;
  const changed = changedPositions(serverIds as string[], orderedIds);
  useEffect(() => { dirty.current = changed.length > 0; }, [changed.length, dirty]);
  const byId = new Map(results.map(count => [count._id as string, count]));
  const ordered = orderedIds.flatMap(id => { const count = byId.get(id); return count ? [count] : []; });
  const pending = draft?.pending ?? false;
  useEffect(() => {
    if (wasReordering.current !== (draft !== null)) {
      scroll.current?.scrollTo({y:0, animated:false});
      const frame = requestAnimationFrame(() => {
        const tag = findNodeHandle(modeControl.current);
        if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
      });
      wasReordering.current = draft !== null;
      return () => cancelAnimationFrame(frame);
    }
  }, [draft !== null]);
  function cancel() { if (!submitting.current) dispatch({type:'cancel'}); }
  function move(id:string, to:number) {
    if (!draft || submitting.current || orderedIds.indexOf(id) === to) return;
    // Incorporate current membership before moving, without ever copying records.
    dispatch({type:'enter', ids:orderedIds});
    dispatch({type:'move', id, to});
  }
  async function save() {
    if (!draft || submitting.current) return;
    if (!convex.connectionState().isWebSocketConnected) return;
    submitting.current = true;
    dispatch({type:'save'});
    try {
      await reorder({ids:orderedIds as typeof serverIds});
      dispatch({type:'success'});
      AccessibilityInfo.announceForAccessibility('Count order saved.');
    } catch { dispatch({type:'failure'}); }
    finally { submitting.current = false; }
  }
  if (view === 'loading') return <View accessibilityRole="progressbar" accessibilityLabel="Loading Counts"><ActivityIndicator /><Typography>Loading Counts…</Typography></View>;
  if (view === 'empty' && !draft) return <ScrollView contentContainerStyle={{flexGrow:1, justifyContent:"center", gap:20, paddingVertical:20}}>
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <Typography accessibilityRole="header" variant="display">Counts</Typography>
    <Typography variant="overline">NO COUNTS YET</Typography>
    <Typography accessibilityRole="header" variant="title">Track your sobriety.</Typography>
    <Typography>Counts keep track of sobriety from any unwanted substance or behavior. Name yours and give it a start date.</Typography>
    <Button onPress={() => router.push('/(app)/counts/new')}>Create your first Count</Button>
    <Typography className="text-center">Your Counts are private to you.</Typography>
    <Typography className="text-center">Create as many as you like.</Typography>
  </ScrollView>;
  return <ScrollView ref={scroll} contentContainerStyle={{gap:20, paddingVertical:20}} scrollEventThrottle={16}
    onLayout={event => {metrics.current.height = event.nativeEvent.layout.height;}}
    onContentSizeChange={(_width,height) => {metrics.current.contentHeight = height;}}
    onScroll={event => {metrics.current.offset = event.nativeEvent.contentOffset.y;}}>
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <View className="flex-row flex-wrap items-center justify-between">
      <View><Typography variant="overline">RECOVERY</Typography><Typography accessibilityRole="header" variant="display">Counts</Typography></View>
      <View className="flex-row">{draft ? <>
        <Pressable ref={modeControl} accessibilityRole="button" accessibilityState={{disabled:pending}} disabled={pending} onPress={cancel} className="min-h-touch justify-center px-md"><Typography className="text-blueprint">Cancel</Typography></Pressable>
        <Button variant="ghost" disabled={pending || !connection.isWebSocketConnected} onPress={save}>{pending ? 'Saving…' : draft.error ? 'Retry' : 'Done'}</Button>
      </> : <>
        <Pressable ref={modeControl} accessibilityRole="button" className="min-h-touch justify-center px-md" onPress={() => {dispatch({type:'enter', ids:serverIds}); AccessibilityInfo.announceForAccessibility('Reorder mode. Use the handles to move Counts.');}}><Typography className="text-blueprint">Reorder</Typography></Pressable>
        <Button variant="ghost" accessibilityLabel="Add Count" onPress={() => router.push('/(app)/counts/new')}>＋</Button>
      </>}</View>
    </View>
    {draft ? <>
      <Typography variant="caption">Reorder loaded Counts. Load more to include more Counts.</Typography>
      {!connection.isWebSocketConnected ? <Typography accessibilityRole="alert">Reconnect to save your order.</Typography> : null}
      {draft.error ? <Typography accessibilityRole="alert">Your order couldn’t be saved. Your changes are still here. Retry or Cancel.</Typography> : null}
      <ReorderRows counts={ordered} now={now} pending={pending} onMove={move} scroll={scroll} metrics={metrics} />
    </> : <View>{results.map((count) => <CountRow key={count._id} count={count} now={now} onPress={() => router.push({ pathname: '/(app)/counts/[id]', params: { id: count._id } })} />)}</View>}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button variant="secondary" disabled={pending || status === 'LoadingMore'} onPress={() => loadMore(25)}>{status === 'LoadingMore' ? 'Loading…' : 'Load more'}</Button> : null}
  </ScrollView>;
}
