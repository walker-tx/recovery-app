import { useReducer, useRef, useState } from "react";
import { View, type TextInput } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import { toSafeAuthError } from "../auth-error-policy";
import { createSubmissionGuard } from "../auth-submission";
import { useWorkOSSession } from "../session/workos-session-provider";
import { useSignupFlow } from "./signup-flow-provider";
import { getVerificationCodeError, initialVerificationState, reduceVerificationState } from "./signup-state";

export function VerifyEmailScreen({ onBack }: { onBack: () => void }) {
  const { completeSignup } = useWorkOSSession();
  const { intentId, completeSignupFlow } = useSignupFlow();
  const guard = useRef(createSubmissionGuard()).current;
  const codeInput = useRef<TextInput>(null);
  const [state, dispatch] = useReducer(reduceVerificationState, initialVerificationState);
  const [codeError, setCodeError] = useState<string>();

  async function handleSubmit() {
    const error = getVerificationCodeError(state.code);
    setCodeError(error);
    if (error) { codeInput.current?.focus(); return; }
    if (intentId === null) return;

    await guard.run({ intentId, code: state.code }, async (values) => {
      dispatch({ type: "submissionStarted" });
      try {
        await completeSignup(values);
        dispatch({ type: "submissionSucceeded" });
        completeSignupFlow();
      } catch (caught) {
        dispatch({ type: "submissionFailed", message: toSafeAuthError("verification", caught) });
      }
    });
  }

  return (
    <Screen contentClassName="w-full max-w-[520px] self-center" keyboardDismissMode="interactive">
      <View className="gap-md">
        <Typography variant="overline">VERIFY EMAIL</Typography>
        <Typography accessibilityRole="header" variant="display">Enter your code</Typography>
        <Typography className="text-ink-muted">Complete signup with the six-digit verification code.</Typography>
      </View>
      <Card.Root elevation="sm">
        <Card.Content>
          <Typography selectable variant="caption">For this local test, copy the verification code from the Convex console output.</Typography>
          {intentId === null ? <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">This signup attempt is no longer available. Go back and start again.</Typography> : null}
          <TextField autoComplete="one-time-code" editable={!state.isPending && intentId !== null} error={codeError} keyboardType="number-pad" label="Verification code" maxLength={6} onChangeText={(value) => { dispatch({ type: "codeChanged", value }); setCodeError(undefined); }} onSubmitEditing={handleSubmit} ref={codeInput} returnKeyType="done" textContentType="oneTimeCode" value={state.code} />
          {state.formError ? <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">{state.formError}</Typography> : null}
        </Card.Content>
        <Card.Footer className="flex-col items-stretch">
          <Button accessibilityLabel={state.isPending ? "Verifying email" : "Verify email"} disabled={intentId === null} loading={state.isPending} onPress={handleSubmit}>{state.isPending ? "Verifying" : "Verify email"}</Button>
          <Button disabled={state.isPending} onPress={onBack} variant="ghost">Back</Button>
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
