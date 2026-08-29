import { useAction } from "convex/react";
import { useReducer, useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { toSafeAuthError } from "../auth-error-policy";
import { createSubmissionGuard } from "../auth-submission";
import { getFirstInvalidResetField, getResetValidation, initialResetState, reduceResetState } from "./recovery-state";

type FieldErrors = ReturnType<typeof getResetValidation>;

export function ResetPasswordScreen({ onBack, onPasswordReset }: { onBack: () => void; onPasswordReset: () => void }) {
  const resetPassword = useAction(api.workosAuth.resetPassword);
  const guard = useRef(createSubmissionGuard()).current;
  const tokenInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmationInput = useRef<TextInput>(null);
  const [state, dispatch] = useReducer(reduceResetState, initialResetState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function handleSubmit() {
    const errors = getResetValidation(state.token, state.password, state.confirmation);
    setFieldErrors(errors);
    const firstInvalid = getFirstInvalidResetField(errors);
    if (firstInvalid !== null) {
      ({ token: tokenInput, password: passwordInput, confirmation: confirmationInput }[firstInvalid]).current?.focus();
      return;
    }

    await guard.run({ token: state.token.trim(), newPassword: state.password }, async (values) => {
      dispatch({ type: "submissionStarted" });
      try {
        await resetPassword(values);
        dispatch({ type: "submissionSucceeded" });
        onPasswordReset();
      } catch (error) {
        dispatch({ type: "submissionFailed", message: toSafeAuthError("reset", error) });
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
        accessibilityLabel="Back"
        accessibilityRole="button"
        accessibilityState={{ disabled: state.isPending }}
        className="min-h-touch self-start justify-center"
        disabled={state.isPending}
        onPress={onBack}
      >
        <Typography variant="label">‹ Back</Typography>
      </Pressable>

      <View className="gap-sm">
        <Typography variant="overline">PASSWORD</Typography>
        <Typography accessibilityRole="header" variant="display">Set a new password</Typography>
        <Typography className="text-ink-muted">Enter the one-time reset token from your recovery email.</Typography>
      </View>

      <View className="gap-lg">
        <TextField
          appearance="filled"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!state.isPending}
          error={fieldErrors.token}
          label="Reset token"
          onChangeText={(value) => {
            dispatch({ type: "tokenChanged", value });
            setFieldErrors((current) => ({ ...current, token: undefined }));
          }}
          onSubmitEditing={() => passwordInput.current?.focus()}
          ref={tokenInput}
          returnKeyType="next"
          submitBehavior="submit"
          value={state.token}
        />
        <View className="gap-xs">
          <TextField
            appearance="filled"
            autoCapitalize="none"
            autoComplete="new-password"
            description="Ten characters or more"
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
            label="New password"
            onChangeText={(value) => {
              dispatch({ type: "passwordChanged", value });
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }}
            onSubmitEditing={() => confirmationInput.current?.focus()}
            ref={passwordInput}
            returnKeyType="next"
            secureTextEntry={!isPasswordVisible}
            submitBehavior="submit"
            textContentType="newPassword"
            value={state.password}
          />
        </View>
        <TextField
          appearance="filled"
          autoCapitalize="none"
          autoComplete="new-password"
          editable={!state.isPending}
          error={fieldErrors.confirmation}
          label="Confirm new password"
          onChangeText={(value) => {
            dispatch({ type: "confirmationChanged", value });
            setFieldErrors((current) => ({ ...current, confirmation: undefined }));
          }}
          onSubmitEditing={handleSubmit}
          ref={confirmationInput}
          returnKeyType="go"
          secureTextEntry
          textContentType="newPassword"
          value={state.confirmation}
        />
        {state.formError ? (
          <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">
            {state.formError}
          </Typography>
        ) : null}
        <Button
          accessibilityLabel={state.isPending ? "Saving password" : "Save password"}
          className="w-full"
          loading={state.isPending}
          onPress={handleSubmit}
        >
          Save password
        </Button>
      </View>
    </Screen>
  );
}
