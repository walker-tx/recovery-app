import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/field";
import { Typography } from "@/components/ui/text";
import { colors } from "@/theme/tokens";

const convexConfigured = Boolean(process.env.EXPO_PUBLIC_CONVEX_URL);
type Mode = "signIn" | "signUp";

export default function HomeScreen() {
  if (!convexConfigured) return <MissingConfiguration />;
  return <AuthScreen />;
}

function AuthScreen() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <Screen><ActivityIndicator accessibilityLabel="Loading account" color={colors.blueprint} /></Screen>;

  if (isAuthenticated) {
    return (
      <Screen contentClassName="w-full max-w-[520px] self-center">
        <View className="gap-md">
          <Typography variant="overline">YOUR SPACE</Typography>
          <Typography variant="display">Welcome back.</Typography>
          <Typography className="text-ink-muted">Your recovery space is ready. We’ll build the next step with care.</Typography>
        </View>
        <Card.Root elevation="sm"><Card.Header><Typography variant="overline">TODAY</Typography><Card.Title>Start where you are</Card.Title><Card.Description>There’s nothing to complete yet. This foundation is intentionally quiet.</Card.Description></Card.Header></Card.Root>
        <Button onPress={() => void signOut()} variant="secondary">Sign out</Button>
      </Screen>
    );
  }

  async function submit() {
    setPending(true);
    setError(null);
    try { await signIn("password", { email: email.trim(), password, flow: mode }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to continue. Please try again."); }
    finally { setPending(false); }
  }
  function changeMode(nextMode: string) {
    if (nextMode !== "signIn" && nextMode !== "signUp") return;
    setMode(nextMode);
    setError(null);
  }

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} className="flex-1">
      <Screen contentClassName="w-full max-w-[520px] self-center">
        <View className="gap-md">
          <Typography variant="overline">RECOVERY</Typography>
          <Typography variant="display">{mode === "signIn" ? "A steady place to return." : "Begin gently."}</Typography>
          <Typography className="text-ink-muted">{mode === "signIn" ? "Sign in to continue at your own pace." : "Create a private space for the work ahead."}</Typography>
        </View>
        <SegmentedControl.Root onValueChange={changeMode} value={mode}><SegmentedControl.Item value="signIn">Sign in</SegmentedControl.Item><SegmentedControl.Item value="signUp">Create account</SegmentedControl.Item></SegmentedControl.Root>
        <View className="gap-lg">
          <TextField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" required value={email} />
          <TextField autoCapitalize="none" autoComplete={mode === "signIn" ? "current-password" : "new-password"} description="Use at least 8 characters." label="Password" onChangeText={setPassword} placeholder="At least 8 characters" required secureTextEntry value={password} />
          {error ? <Typography accessibilityRole="alert" className="text-danger" selectable variant="caption">{error}</Typography> : null}
          <Button disabled={!email.trim() || password.length < 8} loading={pending} onPress={() => void submit()}>{mode === "signIn" ? "Sign in" : "Create account"}</Button>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function MissingConfiguration() {
  return <Screen contentClassName="w-full max-w-[520px] self-center"><View className="gap-md"><Typography variant="overline">RECOVERY</Typography><Typography variant="display">Connect your backend.</Typography><Typography className="text-ink-muted">Copy .env.example to .env and add the Convex deployment URL to begin.</Typography></View></Screen>;
}
