import { useReducer, useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { normalizeEmail } from "./email-policy.ts";
import { createSubmissionGuard } from "./auth-submission.ts";
import {
  getFirstInvalidWorkOSSignInField,
  getWorkOSSignInValidation,
  toSafeWorkOSSignInError,
} from "./workos-auth-policy.ts";
import { initialWorkOSSignInState, reduceWorkOSSignInState } from "./workos-sign-in-state.ts";
import { useWorkOSSession } from "./session/workos-session-provider.tsx";

type WorkOSSignInScreenProps = {
  onBack: () => void;
  onForgotPassword: () => void;
};

type FieldErrors = ReturnType<typeof getWorkOSSignInValidation>;

export function WorkOSSignInScreen({
  onBack,
  onForgotPassword,
}: WorkOSSignInScreenProps) {
  const { signIn } = useWorkOSSession();
  const guard = useRef(createSubmissionGuard()).current;
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const [{ email, password, formError }, dispatch] = useReducer(
    reduceWorkOSSignInState,
    initialWorkOSSignInState,
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    const errors = getWorkOSSignInValidation(email, password);
    setFieldErrors(errors);
    dispatch({ type: "submissionStarted" });
    const firstInvalidField = getFirstInvalidWorkOSSignInField(errors);
    if (firstInvalidField !== null) {
      if (firstInvalidField === "email") emailInput.current?.focus();
      else passwordInput.current?.focus();
      return;
    }

    await guard.run({ email, password }, async (submittedValues) => {
      setIsPending(true);
      try {
        await signIn({
          email: normalizeEmail(submittedValues.email),
          password: submittedValues.password,
        });
      } catch (error) {
        dispatch({ type: "authenticationFailed", message: toSafeWorkOSSignInError(error) });
      } finally {
        setIsPending(false);
      }
    });
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
          accessibilityState={{ disabled: isPending }}
          className="min-h-touch self-start justify-center"
          disabled={isPending}
          onPress={onBack}
        >
          <Typography variant="label">‹ Back</Typography>
        </Pressable>
        <View className="gap-sm">
          <Typography variant="overline">WELCOME BACK</Typography>
          <Typography accessibilityRole="header" variant="display">
            Sign in
          </Typography>
        </View>
      </View>

      <View className="gap-lg">
        <TextField
          appearance="filled"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!isPending}
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
          value={email}
        />
        <TextField
          appearance="filled"
          autoCapitalize="none"
          autoComplete="current-password"
          editable={!isPending}
          endAdornment={
            <Pressable
              accessibilityLabel={isPasswordVisible ? "Hide password" : "Show password"}
              accessibilityRole="button"
              accessibilityState={{ disabled: isPending }}
              className="min-h-touch min-w-touch items-center justify-center px-md"
              disabled={isPending}
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
          textContentType="password"
          value={password}
        />
        {formError ? (
          <Typography
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="text-danger"
            selectable
            variant="caption"
          >
            {formError}
          </Typography>
        ) : null}
        <Button
          accessibilityLabel={isPending ? "Signing in" : "Sign in"}
          className="w-full"
          loading={isPending}
          onPress={handleSubmit}
        >
          {isPending ? "Signing in" : "Sign in"}
        </Button>
        <Button accessibilityRole="link" disabled={isPending} onPress={onForgotPassword} variant="ghost">Forgot your password?</Button>
      </View>
    </Screen>
  );
}
