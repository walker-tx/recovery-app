import {
  ConvexProviderWithAuth,
  type ConvexReactClient,
  useQuery,
} from "convex/react";
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
  if (client === null) {
    return <WorkOSMissingConfiguration />;
  }

  return (
    <WorkOSSessionProvider client={client}>
      <ConvexProviderWithAuth
        client={client}
        useAuth={useWorkOSConvexAuth}
      >
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
  const profile = useQuery(
    api.profiles.getMine,
    session.isAuthenticated ? {} : "skip",
  );
  const destination = getWorkOSRouteDestination(session, profile);

  if (destination === "retry") {
    const retry =
      session.retry?.operation === "restore"
        ? session.retryRestore
        : session.refresh;
    return <WorkOSRetryState onRetry={retry} />;
  }

  if (destination === "loading") {
    return <WorkOSRestorationLoading />;
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

function WorkOSRestorationLoading() {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <View
        accessible
        accessibilityLabel="Loading your account"
        accessibilityRole="progressbar"
        className="items-center gap-md"
      >
        <ActivityIndicator />
        <Typography className="text-ink-muted">
          Loading your account…
        </Typography>
      </View>
    </Screen>
  );
}

function WorkOSRetryState({ onRetry }: { onRetry: () => Promise<unknown> }) {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <View className="items-center gap-md">
        <Typography
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="text-ink-muted"
        >
          We couldn't finish loading your account. Try again.
        </Typography>
        <Button onPress={() => void onRetry().catch(() => undefined)}>
          Try again
        </Button>
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
          <Typography
            accessibilityRole="header"
            variant="display"
          >
            Connect your backend.
          </Typography>
          <Typography className="text-ink-muted">
            Run mise run zero from the repository root to configure and start
            the backend.
          </Typography>
        </View>
      </Screen>
    </>
  );
}
