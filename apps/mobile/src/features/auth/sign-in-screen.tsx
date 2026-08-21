import { useAuthActions } from "@convex-dev/auth/react";
import { useRef, useState } from "react";
import { View, type TextInput } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import {
  getSignInValidation,
  normalizeEmail,
  toSafeSignInError,
} from "./auth-policy";
import { createSubmissionGuard } from "./auth-submission";

type SignInScreenProps = {
  onBack: () => void;
};

type FieldErrors = ReturnType<typeof getSignInValidation>;

export function SignInScreen({ onBack }: SignInScreenProps) {
  const { signIn } = useAuthActions();
  const guard = useRef(createSubmissionGuard()).current;
  const passwordInput = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    const errors = getSignInValidation(email, password);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    await guard.run(async () => {
      setIsPending(true);
      try {
        const result = await signIn("password", {
          email: normalizeEmail(email),
          flow: "signIn",
          password,
        });
        if (!result.signingIn) throw new Error("Sign-in did not create a session");
      } catch (error) {
        setFormError(toSafeSignInError(error));
      } finally {
        setIsPending(false);
      }
    });
  }

  return (
    <Screen
      contentClassName="w-full max-w-[520px] self-center"
      keyboardDismissMode="interactive"
    >
      <View className="gap-md">
        <Typography variant="overline">WELCOME BACK</Typography>
        <Typography accessibilityRole="header" variant="display">
          Sign in
        </Typography>
        <Typography className="text-ink-muted">
          Use the details already connected to your account.
        </Typography>
      </View>

      <Card.Root elevation="sm">
        <Card.Content>
          <TextField
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!isPending}
            error={fieldErrors.email}
            keyboardType="email-address"
            label="Email"
            onChangeText={(value) => {
              setEmail(value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
            onSubmitEditing={() => passwordInput.current?.focus()}
            placeholder="you@example.com"
            returnKeyType="next"
            textContentType="emailAddress"
            value={email}
          />
          <TextField
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!isPending}
            error={fieldErrors.password}
            label="Password"
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((current) => ({ ...current, password: undefined }));
            }}
            onSubmitEditing={handleSubmit}
            ref={passwordInput}
            returnKeyType="go"
            secureTextEntry
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
        </Card.Content>
        <Card.Footer className="flex-col items-stretch">
          <Button
            accessibilityLabel={isPending ? "Signing in" : "Sign in"}
            loading={isPending}
            onPress={handleSubmit}
          >
            {isPending ? "Signing in" : "Sign in"}
          </Button>
          <Button disabled={isPending} onPress={onBack} variant="ghost">
            Back
          </Button>
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
