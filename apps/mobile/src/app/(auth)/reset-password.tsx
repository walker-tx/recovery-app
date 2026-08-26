import { useRouter } from "expo-router";

import { ResetPasswordScreen } from "@/features/auth/recovery/reset-password-screen";

export default function ResetPasswordRoute() {
  const router = useRouter();
  return <ResetPasswordScreen onBack={() => router.back()} onPasswordReset={() => router.replace("./sign-in")} />;
}
