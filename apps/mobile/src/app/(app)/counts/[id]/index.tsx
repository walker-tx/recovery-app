import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { useLocalSearchParams } from 'expo-router';
import { CountDetailScreen } from '@/features/counts/count-detail-screen';
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CountDetailScreen id={id as Id<'counts'>} />;
}
