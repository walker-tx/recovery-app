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
  if (view === 'empty' && !draft) return <ScrollView contentContainerStyle={{flexGrow:1, paddingVertical:20}}>
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <View style={{paddingBottom:18}}><CountsHeader /></View>
    <View className="border border-line" style={{paddingVertical:22, paddingHorizontal:18, gap:11}}>
      {(['top', 'bottom'] as const).flatMap(vertical => (['left', 'right'] as const).map(horizontal =>
        <View key={`${vertical}-${horizontal}`} pointerEvents="none" accessible={false} style={{position:'absolute', [vertical]:-6, [horizontal]:-6, width:11, height:11}}>
          <View className="bg-ink-muted" style={{position:'absolute', left:5, width:1, height:11}} />
          <View className="bg-ink-muted" style={{position:'absolute', top:5, width:11, height:1}} />
        </View>
      ))}
      <Typography variant="overline" className="text-ink-muted" style={{fontSize:10, lineHeight:10, fontWeight:'600', letterSpacing:1.6}}>NO COUNTS YET</Typography>
      <Typography accessibilityRole="header" variant="title" style={{fontSize:26, lineHeight:28.6, fontWeight:'600'}}>Track your sobriety.</Typography>
      <Typography className="text-ink-muted" style={{fontSize:13.5, lineHeight:20.925}}>Counts keep track of sobriety from any unwanted substance or behavior. Name yours and give it a start date.</Typography>
      <Button style={{marginTop:6}} onPress={() => router.push('/(app)/counts/new')}>Create your first Count</Button>
    </View>
    <Typography className="text-ink-muted" style={{marginTop:20, fontSize:12.5, lineHeight:18.75}}>Your Counts are private to you. Create as many as you like.</Typography>
  </ScrollView>;
  return <ScrollView ref={scroll} contentContainerStyle={{gap:20, paddingVertical:20}} scrollEventThrottle={16}
    onLayout={event => {metrics.current.height = event.nativeEvent.layout.height;}}
    onContentSizeChange={(_width,height) => {metrics.current.contentHeight = height;}}
    onScroll={event => {metrics.current.offset = event.nativeEvent.contentOffset.y;}}>
    {offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}
    <View className="flex-row flex-wrap items-center justify-between">
      <CountsHeader />
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

// Local metrics from the approved Counts board; font-family loading is a separate slice.
function CountsHeader() {
  return <View>
    <Typography variant="overline" style={{fontSize:10, lineHeight:10, fontWeight:'600', letterSpacing:1.6}}>RECOVERY</Typography>
    <Typography accessibilityRole="header" variant="title" style={{fontSize:30, lineHeight:31.5, fontWeight:'600', letterSpacing:0, marginTop:2}}>Counts</Typography>
  </View>;
}
