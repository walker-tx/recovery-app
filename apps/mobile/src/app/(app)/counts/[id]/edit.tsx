import type { Id } from '@recovery/backend/convex/_generated/dataModel';
import { useLocalSearchParams } from 'expo-router';
import { EditCountScreen } from '@/features/counts/edit-count-screen';
export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditCountScreen id={id as Id<'counts'>} />;
}
