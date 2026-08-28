import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { View, type TextInput } from "react-native";

import { api } from "@recovery/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";
import {
  DISPLAY_NAME_MAX_LENGTH,
  FIRST_NAME_MAX_LENGTH,
  getFirstInvalidProfileField,
  getProfileValidation,
  normalizeProfileInput,
} from "./onboarding-policy";

type FieldErrors = ReturnType<typeof getProfileValidation>;

export function ProfileScreen() {
  const completeProfile = useMutation(api.profiles.complete);
  const submissionRunning = useRef(false);
  const displayNameRef = useRef<TextInput>(null);
  const firstNameRef = useRef<TextInput>(null);
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (submissionRunning.current) return;

    const errors = getProfileValidation(displayName, firstName);
    setFieldErrors(errors);
    setFormError(null);
    const firstInvalidField = getFirstInvalidProfileField(errors);
    if (firstInvalidField !== null) {
      if (firstInvalidField === "displayName") displayNameRef.current?.focus();
      else firstNameRef.current?.focus();
      return;
    }

    submissionRunning.current = true;
    setIsPending(true);
    try {
      await completeProfile(normalizeProfileInput(displayName, firstName));
    } catch (_error) {
      setFormError("We couldn't save your profile. Please try again.");
    } finally {
      submissionRunning.current = false;
      setIsPending(false);
    }
  }

  return (
    <Screen
      contentClassName="w-full max-w-[520px] self-center"
      contentContainerStyle={{ justifyContent: "flex-start" }}
      keyboardDismissMode="interactive"
    >
      <View className="gap-sm">
        <Typography variant="overline">LAST STEP</Typography>
        <Typography accessibilityRole="header" variant="display">
          What should we call you?
        </Typography>
        <Typography className="text-ink-muted">
          This is the only name your groups see. Make one up if you'd rather — you can change it any time.
        </Typography>
      </View>

      <View className="gap-lg">
        <TextField
          appearance="filled"
          autoCapitalize="words"
          autoComplete="name"
          editable={!isPending}
          error={fieldErrors.displayName}
          label="Display name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChangeText={(value) => {
            setDisplayName(value);
            setFieldErrors((current) => ({ ...current, displayName: undefined }));
            setFormError(null);
          }}
          onSubmitEditing={() => firstNameRef.current?.focus()}
          placeholder="How should we welcome you?"
          ref={displayNameRef}
          returnKeyType="next"
          submitBehavior="submit"
          textContentType="name"
          value={displayName}
        />
        <TextField
          appearance="filled"
          autoCapitalize="words"
          autoComplete="given-name"
          editable={!isPending}
          description="Optional. Leave blank if you like."
          error={fieldErrors.firstName}
          label="First name"
          maxLength={FIRST_NAME_MAX_LENGTH}
          onChangeText={(value) => {
            setFirstName(value);
            setFieldErrors((current) => ({ ...current, firstName: undefined }));
            setFormError(null);
          }}
          onSubmitEditing={handleSubmit}
          ref={firstNameRef}
          returnKeyType="done"
          textContentType="givenName"
          value={firstName}
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
          accessibilityLabel={isPending ? "Saving profile" : "Done"}
          className="w-full"
          loading={isPending}
          onPress={handleSubmit}
        >
          {isPending ? "Saving" : "Done"}
        </Button>
      </View>
    </Screen>
  );
}
