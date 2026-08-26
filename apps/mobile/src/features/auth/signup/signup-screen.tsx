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
import { useSignupFlow } from "./signup-flow-provider";
import { getFirstInvalidSignupField, getSignupValidation, initialSignupState, reduceSignupState, resendSecondsRemaining } from "./signup-state";

type FieldErrors = ReturnType<typeof getSignupValidation>;

export function SignupScreen({ onBack, onVerificationStarted }: { onBack: () => void; onVerificationStarted: () => void }) {
  const startSignup = useAction(api.workosAuth.startSignup);
  const { beginVerification, backToWelcome } = useSignupFlow();
  const guard = useRef(createSubmissionGuard()).current;
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmationInput = useRef<TextInput>(null);
  const [state, dispatch] = useReducer(reduceSignupState, initialSignupState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [now, setNow] = useState(Date.now());
  const cooldownSeconds = resendSecondsRemaining(state.cooldownUntil, now);

  useEffect(() => {
    if (cooldownSeconds === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleSubmit() {
    const errors = getSignupValidation(state.email, state.password, state.confirmation);
    setFieldErrors(errors);
    const firstInvalid = getFirstInvalidSignupField(errors);
    if (firstInvalid !== null) {
      ({ email: emailInput, password: passwordInput, confirmation: confirmationInput }[firstInvalid]).current?.focus();
      return;
    }
    if (cooldownSeconds > 0) return;

    await guard.run({ email: state.email, password: state.password }, async (values) => {
      dispatch({ type: "submissionStarted" });
      try {
        const result = await startSignup({ email: normalizeEmail(values.email), password: values.password });
        const acceptedAt = Date.now();
        dispatch({ type: "submissionAccepted", acceptedAt });
        setNow(acceptedAt);
        beginVerification(result.intentId);
        onVerificationStarted();
      } catch (error) {
        dispatch({ type: "submissionFailed", message: toSafeAuthError("signup", error) });
      }
    });
  }

  function handleBack() {
    backToWelcome();
    onBack();
  }

  return (
    <Screen contentClassName="w-full max-w-[520px] self-center" keyboardDismissMode="interactive">
      <View className="gap-md">
        <Typography variant="overline">CREATE ACCOUNT</Typography>
        <Typography accessibilityRole="header" variant="display">Sign up</Typography>
        <Typography className="text-ink-muted">Use an email and a password with at least 10 characters.</Typography>
      </View>
      <Card.Root elevation="sm">
        <Card.Content>
          <TextField autoCapitalize="none" autoComplete="email" autoCorrect={false} editable={!state.isPending} error={fieldErrors.email} keyboardType="email-address" label="Email" onChangeText={(value) => { dispatch({ type: "emailChanged", value }); setFieldErrors((current) => ({ ...current, email: undefined })); }} onSubmitEditing={() => passwordInput.current?.focus()} placeholder="you@example.com" ref={emailInput} returnKeyType="next" submitBehavior="submit" textContentType="emailAddress" value={state.email} />
          <TextField autoCapitalize="none" autoComplete="new-password" editable={!state.isPending} error={fieldErrors.password} label="Password" onChangeText={(value) => { dispatch({ type: "passwordChanged", value }); setFieldErrors((current) => ({ ...current, password: undefined })); }} onSubmitEditing={() => confirmationInput.current?.focus()} ref={passwordInput} returnKeyType="next" secureTextEntry submitBehavior="submit" textContentType="newPassword" value={state.password} />
          <TextField autoCapitalize="none" autoComplete="new-password" editable={!state.isPending} error={fieldErrors.confirmation} label="Confirm password" onChangeText={(value) => { dispatch({ type: "confirmationChanged", value }); setFieldErrors((current) => ({ ...current, confirmation: undefined })); }} onSubmitEditing={handleSubmit} ref={confirmationInput} returnKeyType="go" secureTextEntry textContentType="newPassword" value={state.confirmation} />
          {state.formError ? <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">{state.formError}</Typography> : null}
          {cooldownSeconds > 0 ? <Typography accessibilityLiveRegion="polite" selectable variant="caption">You can request another code in {cooldownSeconds} seconds.</Typography> : null}
        </Card.Content>
        <Card.Footer className="flex-col items-stretch">
          <Button accessibilityLabel={state.isPending ? "Starting signup" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds} seconds` : "Continue"} disabled={cooldownSeconds > 0} loading={state.isPending} onPress={handleSubmit}>{state.isPending ? "Starting signup" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : "Continue"}</Button>
          <Button disabled={state.isPending} onPress={handleBack} variant="ghost">Back</Button>
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
