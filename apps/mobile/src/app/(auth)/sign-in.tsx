import { useRouter } from "expo-router";

import { WorkOSSignInScreen } from "@/features/auth/workos-sign-in-screen";

export default function SignInRoute() {
  const router = useRouter();

  return (
    <WorkOSSignInScreen
      onBack={() => router.back()}
      onForgotPassword={() => router.push("./forgot-password")}
      onSignUp={() => router.push("./sign-up")}
    />
  );
}
