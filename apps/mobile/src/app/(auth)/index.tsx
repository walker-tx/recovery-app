import { useRouter } from "expo-router";

import { WelcomeScreen } from "@/features/auth/welcome-screen";

export default function WelcomeRoute() {
  const router = useRouter();

  return <WelcomeScreen onSignIn={() => router.push("./sign-in")} />;
}
