import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

type WelcomeScreenProps = {
  onSignIn: () => void;
  onSignUp: () => void;
};

export function WelcomeScreen({ onSignIn, onSignUp }: WelcomeScreenProps) {
  return (
    <Screen
      contentClassName="w-full max-w-[520px] self-center"
      contentContainerStyle={{ justifyContent: "space-between" }}
    >
      <View className="gap-md">
        <Typography variant="overline">RECOVERY TRACKER</Typography>
        <Typography accessibilityRole="header" variant="display">
          Count the days,{"\n"}not alone
        </Typography>
        <Typography className="text-ink-muted">
          Nothing is public. You choose a name, and you choose what the group sees.
        </Typography>
      </View>

      <View className="gap-sm">
        <Button className="w-full" onPress={onSignUp}>
          Create account
        </Button>
        <Button className="w-full" onPress={onSignIn} variant="secondary">
          Sign in
        </Button>
      </View>
    </Screen>
  );
}
