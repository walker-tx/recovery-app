import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

type WelcomeScreenProps = {
  onSignIn: () => void;
};

export function WelcomeScreen({ onSignIn }: WelcomeScreenProps) {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <View className="gap-md">
        <Typography variant="overline">RECOVERY</Typography>
        <Typography accessibilityRole="header" variant="display">
          A steady place to return.
        </Typography>
        <Typography className="text-ink-muted">
          Make space for the next small step, without judgment or pressure.
        </Typography>
      </View>

      <Card.Root elevation="sm">
        <Card.Header>
          <Card.Title>Welcome back</Card.Title>
          <Card.Description>
            Sign in with the email and password already connected to your account.
          </Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button className="w-full" onPress={onSignIn}>
            Sign in
          </Button>
        </Card.Footer>
      </Card.Root>
    </Screen>
  );
}
