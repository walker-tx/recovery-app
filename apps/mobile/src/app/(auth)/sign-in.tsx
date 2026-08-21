import { useRouter } from "expo-router";

import { SignInScreen } from "@/features/auth/sign-in-screen";

export default function SignInRoute() {
  const router = useRouter();

  return <SignInScreen onBack={() => router.back()} />;
}
