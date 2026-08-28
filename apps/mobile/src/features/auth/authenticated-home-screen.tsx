import { useRouter } from "expo-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { useWorkOSSession } from "./session/workos-session-provider";

const signOutError = "Sign out was not completed. Your session is still active. Try again.";

export function AuthenticatedHomeScreen() {
  const router = useRouter();
  const { signOut, isSigningOut } = useWorkOSSession();
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setError(null);
    try {
      await signOut();
      router.replace("/(auth)/sign-in");
    } catch {
      setError(signOutError);
    }
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
            accessibilityLabel={isSigningOut ? "Signing out" : "Sign out"}
            accessibilityState={{ busy: isSigningOut, disabled: isSigningOut }}
            disabled={isSigningOut}
            onPress={() => void handleSignOut()}
            variant="secondary"
          >
            {isSigningOut ? "Signing out" : "Sign out"}
          </Button>
          {error === null ? null : (
            <Typography
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              className="text-danger"
              selectable
              variant="caption"
            >
              {error}
            </Typography>
          )}
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
