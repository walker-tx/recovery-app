import { useReducer, useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";

import { Button } from "@/components/ui/button";
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
  const { intentId, submittedEmail, completeSignupFlow } = useSignupFlow();
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
          className="min-h-touch min-w-touch self-start items-center justify-center"
          disabled={state.isPending}
          onPress={onBack}
        >
          <Typography variant="title">‹</Typography>
        </Pressable>
        <View className="gap-sm">
          <Typography selectable variant="overline">
            {submittedEmail === null ? "EMAIL" : submittedEmail.toUpperCase()}
          </Typography>
          <Typography accessibilityRole="header" variant="display">
            Six digits, from your inbox
          </Typography>
          <Typography className="text-ink-muted">
            Just once, to prove the address is yours.
          </Typography>
        </View>
      </View>

      <View className="gap-lg">
        {intentId === null ? (
          <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">
            This signup attempt is no longer available. Go back and start again.
          </Typography>
        ) : null}
        <TextField
          appearance="filled"
          autoComplete="one-time-code"
          editable={!state.isPending && intentId !== null}
          error={codeError}
          keyboardType="number-pad"
          label="Verification code"
          maxLength={6}
          onChangeText={(value) => {
            dispatch({ type: "codeChanged", value });
            setCodeError(undefined);
          }}
          onSubmitEditing={handleSubmit}
          ref={codeInput}
          returnKeyType="done"
          textContentType="oneTimeCode"
          value={state.code}
        />
        {state.formError ? (
          <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">
            {state.formError}
          </Typography>
        ) : null}
        <Button
          accessibilityLabel={state.isPending ? "Verifying email" : "Verify email"}
          className="w-full"
          disabled={intentId === null}
          loading={state.isPending}
          onPress={handleSubmit}
        >
          {state.isPending ? "Verifying" : "Verify email"}
        </Button>
        <Pressable
          accessibilityRole="link"
          accessibilityState={{ disabled: state.isPending }}
          className="min-h-touch justify-center"
          disabled={state.isPending}
          onPress={onBack}
        >
          <Typography className="text-ink-muted text-center">
            Typo in the address? Change it — nothing has been saved yet.
          </Typography>
        </Pressable>
      </View>
    </Screen>
  );
}
