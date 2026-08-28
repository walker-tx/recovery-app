import { useRouter } from "expo-router";

import { ForgotPasswordScreen } from "@/features/auth/recovery/forgot-password-screen";

export default function ForgotPasswordRoute() {
  const router = useRouter();
  return <ForgotPasswordScreen onBack={() => router.back()} onRecoveryStarted={() => router.push("./reset-password")} />;
}
