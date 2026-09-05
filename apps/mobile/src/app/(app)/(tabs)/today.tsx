import { Screen } from '@/components/ui/screen';
import { Typography } from '@/components/ui/text';
export default function TodayRoute() {
  return <Screen contentClassName="justify-start">
    <Typography accessibilityRole="header" variant="display">Today</Typography>
    <Typography>Coming later.</Typography>
  </Screen>;
}
