import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { useLocalSearchParams } from 'expo-router';
import { CountUnitsScreen } from '@/features/counts/count-units-screen';
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CountUnitsScreen id={id as Id<'counts'>} />;
}
