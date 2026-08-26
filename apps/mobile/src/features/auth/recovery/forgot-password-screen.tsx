import { useAction } from "convex/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { View, type TextInput } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { toSafeAuthError } from "../auth-error-policy";
import { createSubmissionGuard } from "../auth-submission";
import { normalizeEmail } from "../email-policy";
import { getRecoveryValidation, initialRecoveryState, recoveryResendSecondsRemaining, reduceRecoveryState } from "./recovery-state";

export function ForgotPasswordScreen({ onBack, onRecoveryStarted }: { onBack: () => void; onRecoveryStarted: () => void }) {
  const startRecovery = useAction(api.workosAuth.startRecovery);
  const guard = useRef(createSubmissionGuard()).current;
  const emailInput = useRef<TextInput>(null);
  const [state, dispatch] = useReducer(reduceRecoveryState, initialRecoveryState);
  const [emailError, setEmailError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const cooldownSeconds = recoveryResendSecondsRemaining(state.cooldownUntil, now);

  useEffect(() => {
    if (cooldownSeconds === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleSubmit() {
    const errors = getRecoveryValidation(state.email);
    setEmailError(errors.email);
    if (errors.email) { emailInput.current?.focus(); return; }
    if (cooldownSeconds > 0) return;

    await guard.run(state.email, async (email) => {
      dispatch({ type: "submissionStarted" });
      try {
        await startRecovery({ email: normalizeEmail(email) });
        const acceptedAt = Date.now();
        dispatch({ type: "submissionSucceeded", acceptedAt });
        setNow(acceptedAt);
        onRecoveryStarted();
      } catch (error) {
        dispatch({ type: "submissionFailed", message: toSafeAuthError("recovery", error) });
      }
    });
  }

  return (
    <Screen contentClassName="w-full max-w-[520px] self-center" keyboardDismissMode="interactive">
      <View className="gap-md">
        <Typography variant="overline">ACCOUNT RECOVERY</Typography>
        <Typography accessibilityRole="header" variant="display">Forgot password</Typography>
        <Typography className="text-ink-muted">Enter your email to request password-reset instructions.</Typography>
      </View>
      <Card.Root elevation="sm">
        <Card.Content>
          <TextField autoCapitalize="none" autoComplete="email" autoCorrect={false} editable={!state.isPending} error={emailError} keyboardType="email-address" label="Email" onChangeText={(value) => { dispatch({ type: "emailChanged", value }); setEmailError(undefined); }} onSubmitEditing={handleSubmit} placeholder="you@example.com" ref={emailInput} returnKeyType="go" textContentType="emailAddress" value={state.email} />
          <Typography selectable variant="caption">For this local test, reset instructions appear in the Convex console only when the account can use password recovery.</Typography>
          {state.formError ? <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">{state.formError}</Typography> : null}
          {cooldownSeconds > 0 ? <Typography accessibilityLiveRegion="polite" selectable variant="caption">You can request another reset in {cooldownSeconds} seconds.</Typography> : null}
        </Card.Content>
        <Card.Footer className="flex-col items-stretch">
          <Button accessibilityLabel={state.isPending ? "Requesting reset" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds} seconds` : "Request reset"} disabled={cooldownSeconds > 0} loading={state.isPending} onPress={handleSubmit}>{state.isPending ? "Requesting reset" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : "Request reset"}</Button>
          <Button disabled={state.isPending} onPress={onBack} variant="ghost">Back</Button>
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
