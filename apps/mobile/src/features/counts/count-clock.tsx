import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { startMinuteClock } from './count-reading';
const Clock = createContext<number | null>(null);
export function CountClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = startMinuteClock(setNow, { now: Date.now, schedule: setTimeout, cancel: clearTimeout });
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') clock.refresh(); });
    return () => { subscription.remove(); clock.stop(); };
  }, []);
  return <Clock value={now}>{children}</Clock>;
}
export function useCountNow() {
  const now = use(Clock);
  if (now === null) throw new Error('Counts require CountClockProvider');
  return now;
}
