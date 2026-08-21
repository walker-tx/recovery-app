import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

export default function SignInRoute() {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <Typography variant="display">Sign in</Typography>
      <Typography className="text-ink-muted">
        Returning-user sign-in will be available here.
      </Typography>
    </Screen>
  );
}
