import "../../global.css";

import { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { migrateLegacyConvexAuthStorage } from "@/features/auth/session/legacy-convex-auth-storage-migration";
import { WorkOSRootProvider } from "@/features/auth/workos-root-provider";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function RootLayout() {
  if (convexUrl === undefined) return <WorkOSRootProvider client={null} />;

  return (
    <LegacyConvexAuthMigrationGate convexUrl={convexUrl}>
      <WorkOSRootProvider client={convex} />
    </LegacyConvexAuthMigrationGate>
  );
}

function LegacyConvexAuthMigrationGate({
  children,
  convexUrl: migrationConvexUrl,
}: {
  children: ReactNode;
  convexUrl: string;
}) {
  const [migrationState, setMigrationState] = useState<"pending" | "error" | "complete">("pending");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setMigrationState("pending");
    void migrateLegacyConvexAuthStorage(SecureStore, migrationConvexUrl)
      .then(() => {
        if (active) setMigrationState("complete");
      })
      .catch(() => {
        if (active) setMigrationState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt, migrationConvexUrl]);

  function retryMigration() {
    setAttempt((current) => current + 1);
  }

  if (migrationState === "complete") return children;

  if (migrationState === "error") {
    return (
      <Screen contentClassName="w-full max-w-[520px] self-center">
        <View className="gap-md">
          <Typography accessibilityLiveRegion="polite" accessibilityRole="alert">
            Secure sign in could not be prepared. Try again.
          </Typography>
          <Button onPress={retryMigration}>Try again</Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <View
        accessible
        accessibilityLabel="Preparing secure sign in"
        accessibilityRole="progressbar"
        className="items-center gap-md"
      >
        <ActivityIndicator />
        <Typography className="text-ink-muted">Preparing secure sign in…</Typography>
      </View>
    </Screen>
  );
}
