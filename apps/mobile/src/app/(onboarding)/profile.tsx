import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

export default function ProfileRoute() {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <Typography variant="display">Your profile</Typography>
      <Typography className="text-ink-muted">
        Profile onboarding will be available here.
      </Typography>
    </Screen>
  );
}
