import { useRouter } from "expo-router";

import { ResetPasswordScreen } from "@/features/auth/recovery/reset-password-screen";

export default function ResetPasswordRoute() {
  const router = useRouter();

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("./sign-in");
    }
  }

  return (
    <ResetPasswordScreen
      onBack={handleBack}
      onPasswordReset={() => router.replace("./sign-in")}
    />
  );
}
