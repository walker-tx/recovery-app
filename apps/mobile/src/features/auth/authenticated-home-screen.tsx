import { useAuthActions } from "@convex-dev/auth/react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { createSubmissionGuard } from "./auth-submission";

export function AuthenticatedHomeScreen() {
  const { signOut } = useAuthActions();
  const guard = useRef(createSubmissionGuard()).current;
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    await guard.run(undefined, async () => {
      setIsPending(true);
      setError(null);
      try {
        await signOut();
      } catch (_error) {
        setError("We couldn't sign you out. Please try again.");
        setIsPending(false);
      }
    });
  }

  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <Typography variant="overline">YOUR SPACE</Typography>
      <Typography accessibilityRole="header" variant="display">
        Welcome back.
      </Typography>
      <Card.Root elevation="sm">
        <Card.Header>
          <Card.Title>Start where you are</Card.Title>
          <Card.Description>
            There is nothing to complete yet. This foundation is intentionally quiet.
          </Card.Description>
        </Card.Header>
        <Card.Footer className="flex-col items-stretch">
          <Button
            accessibilityLabel={isPending ? "Signing out" : "Sign out"}
            loading={isPending}
            onPress={handleSignOut}
            variant="secondary"
          >
            {isPending ? "Signing out" : "Sign out"}
          </Button>
          {error ? (
            <Typography
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              className="text-danger"
              selectable
              variant="caption"
            >
              {error}
            </Typography>
          ) : null}
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
