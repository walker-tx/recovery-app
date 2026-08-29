import { useRouter } from "expo-router";

import { ForgotPasswordScreen } from "@/features/auth/recovery/forgot-password-screen";

export default function ForgotPasswordRoute() {
  const router = useRouter();

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace("./sign-in");
  }

  return <ForgotPasswordScreen onBack={handleBack} onEnterResetToken={() => router.push("./reset-password")} />;
}
