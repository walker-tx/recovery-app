import { useAction } from "convex/react";
import { useReducer, useRef, useState } from "react";
import { View, type TextInput } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <Screen contentClassName="w-full max-w-[520px] self-center" keyboardDismissMode="interactive">
      <View className="gap-md">
        <Typography variant="overline">ACCOUNT RECOVERY</Typography>
        <Typography accessibilityRole="header" variant="display">Reset password</Typography>
        <Typography className="text-ink-muted">Paste the reset token and choose a new password.</Typography>
      </View>
      <Card.Root elevation="sm">
        <Card.Content>
          <Typography selectable variant="caption">For this local test, copy the one-time reset token from the Convex console output. It is not stored in navigation or on this device.</Typography>
          <TextField autoCapitalize="none" autoCorrect={false} editable={!state.isPending} error={fieldErrors.token} label="Reset token" onChangeText={(value) => { dispatch({ type: "tokenChanged", value }); setFieldErrors((current) => ({ ...current, token: undefined })); }} onSubmitEditing={() => passwordInput.current?.focus()} ref={tokenInput} returnKeyType="next" submitBehavior="submit" value={state.token} />
          <TextField autoCapitalize="none" autoComplete="new-password" editable={!state.isPending} error={fieldErrors.password} label="New password" onChangeText={(value) => { dispatch({ type: "passwordChanged", value }); setFieldErrors((current) => ({ ...current, password: undefined })); }} onSubmitEditing={() => confirmationInput.current?.focus()} ref={passwordInput} returnKeyType="next" secureTextEntry submitBehavior="submit" textContentType="newPassword" value={state.password} />
          <TextField autoCapitalize="none" autoComplete="new-password" editable={!state.isPending} error={fieldErrors.confirmation} label="Confirm new password" onChangeText={(value) => { dispatch({ type: "confirmationChanged", value }); setFieldErrors((current) => ({ ...current, confirmation: undefined })); }} onSubmitEditing={handleSubmit} ref={confirmationInput} returnKeyType="go" secureTextEntry textContentType="newPassword" value={state.confirmation} />
          {state.formError ? <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">{state.formError}</Typography> : null}
        </Card.Content>
        <Card.Footer className="flex-col items-stretch">
          <Button accessibilityLabel={state.isPending ? "Resetting password" : "Reset password"} loading={state.isPending} onPress={handleSubmit}>{state.isPending ? "Resetting password" : "Reset password"}</Button>
          <Button disabled={state.isPending} onPress={onBack} variant="ghost">Back</Button>
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
