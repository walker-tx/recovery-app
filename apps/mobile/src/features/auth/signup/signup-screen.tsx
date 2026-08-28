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
import { useSignupFlow } from "./signup-flow-provider";
import { getFirstInvalidSignupField, getSignupValidation, initialSignupState, reduceSignupState, resendSecondsRemaining } from "./signup-state";

type FieldErrors = ReturnType<typeof getSignupValidation>;

export function SignupScreen({ onBack, onVerificationStarted }: { onBack: () => void; onVerificationStarted: () => void }) {
  const startSignup = useAction(api.workosAuth.startSignup);
  const { beginVerification, backToWelcome } = useSignupFlow();
  const guard = useRef(createSubmissionGuard()).current;
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const [state, dispatch] = useReducer(reduceSignupState, initialSignupState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [now, setNow] = useState(Date.now());
  const cooldownSeconds = resendSecondsRemaining(state.cooldownUntil, now);

  useEffect(() => {
    if (cooldownSeconds === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleSubmit() {
    const errors = getSignupValidation(state.email, state.password);
    setFieldErrors(errors);
    const firstInvalid = getFirstInvalidSignupField(errors);
    if (firstInvalid !== null) {
      ({ email: emailInput, password: passwordInput }[firstInvalid]).current?.focus();
      return;
    }
    if (cooldownSeconds > 0) return;

    await guard.run({ email: state.email, password: state.password }, async (values) => {
      dispatch({ type: "submissionStarted" });
      try {
        const submittedEmail = normalizeEmail(values.email);
        const result = await startSignup({ email: submittedEmail, password: values.password });
        const acceptedAt = Date.now();
        dispatch({ type: "submissionAccepted", acceptedAt });
        setNow(acceptedAt);
        beginVerification(result.intentId, submittedEmail);
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
    <Screen
      contentClassName="w-full max-w-[520px] self-center"
      contentContainerStyle={{ justifyContent: "flex-start" }}
      keyboardDismissMode="interactive"
    >
      <View className="gap-lg">
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          accessibilityState={{ disabled: state.isPending }}
          className="min-h-touch self-start justify-center"
          disabled={state.isPending}
          onPress={handleBack}
        >
          <Typography variant="label">‹ Back</Typography>
        </Pressable>
        <View className="gap-sm">
          <Typography variant="overline">NEW ACCOUNT</Typography>
          <Typography accessibilityRole="header" variant="display">
            Your email and a password
          </Typography>
          <Typography className="text-ink-muted">
            We use the address to get you back in if you're locked out. Nothing else.
          </Typography>
        </View>
      </View>

      <View className="gap-lg">
        <TextField
          appearance="filled"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!state.isPending}
          error={fieldErrors.email}
          keyboardType="email-address"
          label="Email"
          onChangeText={(value) => {
            dispatch({ type: "emailChanged", value });
            setFieldErrors((current) => ({ ...current, email: undefined }));
          }}
          onSubmitEditing={() => passwordInput.current?.focus()}
          placeholder="you@example.com"
          ref={emailInput}
          returnKeyType="next"
          textContentType="emailAddress"
          value={state.email}
        />
        <View className="gap-xs">
          <TextField
            appearance="filled"
            autoCapitalize="none"
            autoComplete="new-password"
            editable={!state.isPending}
            endAdornment={
              <Pressable
                accessibilityLabel={isPasswordVisible ? "Hide password" : "Show password"}
                accessibilityRole="button"
                accessibilityState={{ disabled: state.isPending }}
                className="min-h-touch min-w-touch items-center justify-center px-md"
                disabled={state.isPending}
                onPress={() => setIsPasswordVisible((current) => !current)}
              >
                <Typography className="text-blueprint-pressed" variant="overline">
                  {isPasswordVisible ? "HIDE" : "SHOW"}
                </Typography>
              </Pressable>
            }
            error={fieldErrors.password}
            label="Password"
            onChangeText={(value) => {
              dispatch({ type: "passwordChanged", value });
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }}
            onSubmitEditing={handleSubmit}
            ref={passwordInput}
            returnKeyType="go"
            secureTextEntry={!isPasswordVisible}
            textContentType="newPassword"
            value={state.password}
          />
          <Typography className="text-ink-muted" variant="caption">
            Ten characters or more. This is the one thing you'll need to remember.
          </Typography>
        </View>
        {state.formError ? (
          <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">
            {state.formError}
          </Typography>
        ) : null}
        <Button
          accessibilityLabel={state.isPending ? "Starting signup" : cooldownSeconds > 0 ? "Continue unavailable" : "Continue"}
          className="w-full"
          disabled={cooldownSeconds > 0}
          loading={state.isPending}
          onPress={handleSubmit}
        >
          {state.isPending ? "Starting signup" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : "Continue"}
        </Button>
      </View>
    </Screen>
  );
}
