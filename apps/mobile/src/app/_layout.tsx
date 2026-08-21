import "../../global.css";

import {
  ConvexAuthProvider,
  type TokenStorage,
  useConvexAuth,
} from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

const secureStorage: TokenStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function RootLayout() {
  if (!convex) return <MissingConfiguration />;

  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      <StatusBar style="dark" />
      <AuthenticatedRoutes />
    </ConvexAuthProvider>
  );
}

function AuthenticatedRoutes() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

function MissingConfiguration() {
  return (
    <>
      <StatusBar style="dark" />
      <Screen contentClassName="w-full max-w-[520px] self-center">
        <View className="gap-md">
          <Typography variant="overline">RECOVERY</Typography>
          <Typography variant="display">Connect your backend.</Typography>
          <Typography className="text-ink-muted">
            Copy .env.example to .env and add the Convex deployment URL to begin.
          </Typography>
        </View>
      </Screen>
    </>
  );
}
