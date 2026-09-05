import type { api } from '@recovery/backend/convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import { Pressable, View } from 'react-native';
import { Typography } from '@/components/ui/text';
import { elapsedParts, latestMilestone, type Milestone } from './elapsed-policy';
import { formatPart, formatStarted } from './count-reading';
export function MilestoneBadge({ milestone }: { milestone: Milestone }) {
  return <View className="shrink-0 self-start rounded-full border border-blueprint/20 bg-blueprint/10 px-sm py-xs"><Typography className="text-blueprint" style={{ fontSize: 10 }}>{formatPart(milestone)}</Typography></View>;
}
export function CountReading({ count, now, size = 'row' }: { count: FunctionReturnType<typeof api.counts.get>; now: number; size?: 'row' | 'detail' }) {
  const parts = elapsedParts(count.startAt, now, count.unit);
  return <View className="flex-row flex-wrap items-baseline" style={{ gap: size === 'row' ? 7 : 9 }}>
    {parts ? parts.map((part, index) => <Typography key={part.unit} className={index === 0 ? 'text-blueprint' : 'text-ink-muted'} style={{ fontSize: index === 0 ? (size === 'row' ? 24 : 40) : (size === 'row' ? 15 : 20), fontVariant: ['tabular-nums'] }}>{formatPart(part)}</Typography>) : <Typography>Reading unavailable.</Typography>}
  </View>;
}
export function CountRow({ count, now, onPress }: { count: FunctionReturnType<typeof api.counts.get>; now: number; onPress?: () => void }) {
  const milestone = latestMilestone(count.startAt, now);
  return <Pressable accessibilityRole={onPress ? "button" : undefined} disabled={!onPress} onPress={onPress} className="flex-row items-center border-t border-line active:opacity-70" style={{ gap: 14, paddingVertical: 15 }}>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Typography numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1, fontSize: 15, fontWeight: '500' }}>{count.name}</Typography>
        {milestone ? <MilestoneBadge milestone={milestone} /> : null}
      </View>
      <CountReading count={count} now={now} />
      <Typography variant="caption" style={{ fontSize: 11 }}>since {formatStarted(count.startAt)}</Typography>
    </View>
    {onPress ? <Typography accessibilityElementsHidden importantForAccessibility="no">›</Typography> : null}
  </Pressable>;
}
