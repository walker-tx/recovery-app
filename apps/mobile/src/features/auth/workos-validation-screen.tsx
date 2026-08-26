import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { useWorkOSSession } from "./session/workos-session-provider";

const signOutError = "Sign out was not completed. Your session is still active. Try again.";

export function WorkOSValidationScreen() {
  const account = useQuery(api.workosAccount.getCurrentWorkOSAccount);
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
    <Screen contentClassName="items-center">
      <Card.Root className="w-full max-w-lg" elevation="sm">
        <Card.Header>
          <Card.Title>Signed in with WorkOS</Card.Title>
        </Card.Header>
        <Card.Content>
          {account === undefined ? (
            <Typography accessibilityLiveRegion="polite" variant="body">Loading account…</Typography>
          ) : (
            <View className="gap-md">
              <View className="gap-xs">
                <Typography variant="caption">Email</Typography>
                <Typography selectable>{account.email}</Typography>
              </View>
              <View className="gap-xs">
                <Typography variant="caption">WorkOS user ID</Typography>
                <Typography selectable>{account.userId}</Typography>
              </View>
            </View>
          )}
        </Card.Content>
        <Button
          accessibilityLabel={isSigningOut ? "Signing out" : "Sign out"}
          accessibilityState={{ busy: isSigningOut, disabled: isSigningOut }}
          disabled={isSigningOut}
          onPress={() => void handleSignOut()}
        >
          {isSigningOut ? "Signing out" : "Sign out"}
        </Button>
        {error === null ? null : (
          <Typography
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="text-danger"
            variant="body"
          >
            {error}
          </Typography>
        )}
      </Card.Root>
    </Screen>
  );
}
