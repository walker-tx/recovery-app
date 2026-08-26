import { ConvexProviderWithAuth, type ConvexReactClient, useQuery } from "convex/react";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { SignupFlowProvider } from "./signup/signup-flow-provider.tsx";
import {
  useWorkOSConvexAuth,
  useWorkOSSession,
  WorkOSSessionProvider,
} from "./session/workos-session-provider.tsx";
import { getWorkOSRouteDestination } from "./workos-auth-policy.ts";

type WorkOSRootProviderProps = {
  client: ConvexReactClient | null;
};

export function WorkOSRootProvider({ client }: WorkOSRootProviderProps) {
  if (client === null) return <WorkOSMissingConfiguration />;

  return (
    <WorkOSSessionProvider client={client}>
      <ConvexProviderWithAuth client={client} useAuth={useWorkOSConvexAuth}>
        <SignupFlowProvider>
          <StatusBar style="dark" />
          <WorkOSProtectedRoutes />
        </SignupFlowProvider>
      </ConvexProviderWithAuth>
    </WorkOSSessionProvider>
  );
}

export function WorkOSProtectedRoutes() {
  const session = useWorkOSSession();
  const profile = useQuery(api.profiles.getMine, session.isAuthenticated ? {} : "skip");
  const destination = getWorkOSRouteDestination(session, profile);

  if (destination === "loading") {
    return (
      <WorkOSRestorationLoading
        canRetry={session.retry?.operation === "restore"}
        onRetry={session.retryRestore}
      />
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={destination === "auth"}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={destination === "onboarding"}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={destination === "app"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

function WorkOSRestorationLoading({
  canRetry,
  onRetry,
}: {
  canRetry: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <View className="items-center gap-md">
        <View
          accessible
          accessibilityLabel={canRetry ? "Account loading paused" : "Loading your account"}
          accessibilityRole="progressbar"
          className="items-center gap-md"
        >
          <ActivityIndicator />
          <Typography className="text-ink-muted">
            {canRetry ? "We couldn't restore your account. Try again." : "Loading your account…"}
          </Typography>
        </View>
        {canRetry ? (
          <Button onPress={() => void onRetry().catch(() => undefined)}>Try again</Button>
        ) : null}
      </View>
    </Screen>
  );
}

function WorkOSMissingConfiguration() {
  return (
    <>
      <StatusBar style="dark" />
      <Screen contentClassName="w-full max-w-[520px] self-center">
        <View className="gap-md">
          <Typography variant="overline">RECOVERY</Typography>
          <Typography accessibilityRole="header" variant="display">Connect your backend.</Typography>
          <Typography className="text-ink-muted">
            Copy .env.example to .env and add the Convex deployment URL to begin.
          </Typography>
        </View>
      </Screen>
    </>
  );
}
