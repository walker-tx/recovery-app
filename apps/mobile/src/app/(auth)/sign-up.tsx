import { useRouter } from "expo-router";

import { SignupScreen } from "@/features/auth/signup/signup-screen";

export default function SignupRoute() {
  const router = useRouter();
  return (
    <SignupScreen
      onBack={() => router.back()}
      onVerificationStarted={() => router.push("./verify-email")}
    />
  );
}
