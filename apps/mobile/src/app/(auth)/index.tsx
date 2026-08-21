import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

export default function WelcomeRoute() {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <Typography variant="overline">RECOVERY</Typography>
      <Typography variant="display">A steady place to return.</Typography>
      <Typography className="text-ink-muted">
        Sign-in access is being prepared with care.
      </Typography>
    </Screen>
  );
}
