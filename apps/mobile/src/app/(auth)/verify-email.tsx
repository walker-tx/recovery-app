import { useRouter } from "expo-router";

import { VerifyEmailScreen } from "@/features/auth/signup/verify-email-screen";

export default function VerifyEmailRoute() {
  const router = useRouter();
  return <VerifyEmailScreen onBack={() => router.back()} />;
}
