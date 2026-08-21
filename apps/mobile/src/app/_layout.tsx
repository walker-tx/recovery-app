import "../../global.css";

import { ConvexAuthProvider, type TokenStorage } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

const secureStorage: TokenStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function RootLayout() {
  const content = (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );

  if (!convex) return content;

  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      {content}
    </ConvexAuthProvider>
  );
}
