import type { ConvexHttpClient } from "convex/browser";
import { createSessionTransport } from "./session/session-transport.ts";
import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
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
  client: ConvexHttpClient | null;
};

export function WorkOSRootProvider({ client }: WorkOSRootProviderProps) {
  if (client === null) return <WorkOSMissingConfiguration />;

  return (
    <WorkOSSessionProvider client={client}>
      <WorkOSLifetime client={client} />
    </WorkOSSessionProvider>
  );
}

function WorkOSLifetime({ client }: { client: ConvexHttpClient }) {
  const { lifetime } = useWorkOSSession();
  return <WorkOSSyncLifetime key={lifetime} url={client.url} />;
}

function WorkOSSyncLifetime({ url }: { url: string }) {
  const { lifetime, getLifetime } = useWorkOSSession();
  const [transport, setTransport] = useState<ReturnType<typeof createSessionTransport<ConvexReactClient>> | null>(null);
  useEffect(() => {
    const next = createSessionTransport(() => new ConvexReactClient(url), lifetime, getLifetime);
    setTransport(next);
    return () => next.retire();
  }, [url, lifetime, getLifetime]);

  function useLifetimeAuth() {
    const auth = useWorkOSConvexAuth();
    const fetchAccessToken = useCallback(
      (input: { forceRefreshToken: boolean }) => transport!.fetchAccessToken(auth.fetchAccessToken, input),
      [auth.fetchAccessToken, transport],
    );
    return { ...auth, fetchAccessToken };
  }

  if (transport === null) return <WorkOSRestorationLoading />;
  return (
      <ConvexProviderWithAuth client={transport.client} useAuth={useLifetimeAuth}>
        <SignupFlowProvider>
          <StatusBar style="dark" />
          <WorkOSProtectedRoutes />
        </SignupFlowProvider>
      </ConvexProviderWithAuth>
  );
}

export function WorkOSProtectedRoutes() {
  const session = useWorkOSSession();
  const [profile, setProfile] = useState<{ onboardingComplete: boolean } | null>();
  const [readyLifetime, setReadyLifetime] = useState<number>();
  const onProfile = useCallback((value: { onboardingComplete: boolean } | null | undefined) => {
    setProfile(value);
    if (value?.onboardingComplete) setReadyLifetime(session.lifetime);
  }, [session.lifetime]);
  const destination = getWorkOSRouteDestination(session, profile, readyLifetime);
  const observer = <WorkOSProfileBoundary><WorkOSProfileObserver onProfile={onProfile} /></WorkOSProfileBoundary>;

  if (destination === "retry") {
    const retry = session.retry?.operation === "restore" ? session.retryRestore : session.refresh;
    return <>{observer}<WorkOSRetryState onRetry={retry} /></>;
  }

  if (destination === "loading") return <>{observer}<WorkOSRestorationLoading /></>;

  return (
    <>
    {observer}
    {session.retry?.operation === "refresh" && <WorkOSRefreshRetry onRetry={session.refresh} />}
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
    </>
  );
}

// Only this observer can throw on profile reads; it never owns the navigator.
function WorkOSProfileObserver({ onProfile }: { onProfile: (value: { onboardingComplete: boolean } | null | undefined) => void }) {
  const { isAuthenticated } = useConvexAuth();
  const profile = useQuery(api.profiles.getMine, isAuthenticated ? {} : "skip");
  useEffect(() => { onProfile(isAuthenticated ? profile : undefined); }, [isAuthenticated, profile, onProfile]);
  return null;
}

class WorkOSProfileBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <WorkOSRefreshRetry onRetry={async () => { this.setState({ failed: false }); }} />;
  }
}

function WorkOSRefreshRetry({ onRetry }: { onRetry: () => Promise<unknown> }) {
  return <View className="gap-sm p-md">
    <Typography accessibilityRole="alert" accessibilityLiveRegion="polite">Account connection interrupted. Your open work is preserved.</Typography>
    <Button onPress={() => void onRetry().catch(() => undefined)}>Try again</Button>
  </View>;
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
        <Typography className="text-ink-muted">Loading your account…</Typography>
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
        <Button onPress={() => void onRetry().catch(() => undefined)}>Try again</Button>
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
            Run mise run zero from the repository root to configure and start the backend.
          </Typography>
        </View>
      </Screen>
    </>
  );
}
