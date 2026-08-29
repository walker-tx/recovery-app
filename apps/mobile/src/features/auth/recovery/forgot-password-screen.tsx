import { useAction } from "convex/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { toSafeAuthError } from "../auth-error-policy";
import { createSubmissionGuard } from "../auth-submission";
import { normalizeEmail } from "../email-policy";
import { getRecoveryValidation, initialRecoveryState, recoveryResendSecondsRemaining, reduceRecoveryState } from "./recovery-state";

export function ForgotPasswordScreen({
  onBack,
  onEnterResetToken,
}: {
  onBack: () => void;
  onEnterResetToken: () => void;
}) {
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
    if (errors.email) {
      emailInput.current?.focus();
      return;
    }
    if (cooldownSeconds > 0) return;

    await guard.run(state.email, async (email) => {
      dispatch({ type: "submissionStarted" });
      try {
        const submittedEmail = normalizeEmail(email);
        await startRecovery({ email: submittedEmail });
        const acceptedAt = Date.now();
        dispatch({ type: "submissionSucceeded", acceptedAt, submittedEmail });
        setNow(acceptedAt);
      } catch (error) {
        dispatch({ type: "submissionFailed", message: toSafeAuthError("recovery", error) });
      }
    });
  }

  return (
    <Screen
      contentClassName="w-full max-w-[520px] self-center"
      contentContainerStyle={{ justifyContent: "flex-start" }}
      keyboardDismissMode="interactive"
    >
      <Pressable
        accessibilityLabel="Sign in"
        accessibilityRole="button"
        accessibilityState={{ disabled: state.isPending }}
        className="min-h-touch self-start justify-center"
        disabled={state.isPending}
        onPress={onBack}
      >
        <Typography variant="label">‹ Sign in</Typography>
      </Pressable>

      {state.submittedEmail ? (
        <View className="gap-lg">
          <View className="gap-sm">
            <Typography variant="overline">PASSWORD</Typography>
            <Typography accessibilityRole="header" variant="display">Check your email</Typography>
            <Typography className="text-ink-muted" selectable>
              If there is an account for {state.submittedEmail}, a reset link is on its way and is good for one hour.
            </Typography>
          </View>
          {state.formError ? (
            <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">
              {state.formError}
            </Typography>
          ) : null}
          {cooldownSeconds > 0 ? <Typography selectable variant="caption">You can request another link in {cooldownSeconds} seconds.</Typography> : null}
          <View className="gap-xs">
            <Button
              accessibilityLabel={state.isPending ? "Resending the link" : cooldownSeconds > 0 ? "Resend unavailable" : "Resend the link"}
              className="w-full"
              disabled={cooldownSeconds > 0}
              loading={state.isPending}
              onPress={handleSubmit}
            >
              Resend the link
            </Button>
            <Button accessibilityRole="link" disabled={state.isPending} onPress={onEnterResetToken} variant="ghost">
              Enter reset token
            </Button>
          </View>
        </View>
      ) : (
        <>
          <View className="gap-sm">
            <Typography variant="overline">PASSWORD</Typography>
            <Typography accessibilityRole="header" variant="display">Reset it</Typography>
            <Typography className="text-ink-muted">
              Tell us the address on the account and we'll send a link. Your groups and your counts aren't touched.
            </Typography>
          </View>
          <View className="gap-lg">
            <TextField
              appearance="filled"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!state.isPending}
              error={emailError}
              keyboardType="email-address"
              label="Email"
              onChangeText={(value) => {
                dispatch({ type: "emailChanged", value });
                setEmailError(undefined);
              }}
              onSubmitEditing={handleSubmit}
              placeholder="you@example.com"
              ref={emailInput}
              returnKeyType="go"
              textContentType="emailAddress"
              value={state.email}
            />
            {state.formError ? (
              <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">
                {state.formError}
              </Typography>
            ) : null}
            <Button
              accessibilityLabel={state.isPending ? "Sending the link" : "Send the link"}
              className="w-full"
              loading={state.isPending}
              onPress={handleSubmit}
            >
              Send the link
            </Button>
          </View>
        </>
      )}
    </Screen>
  );
}
