import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Typography } from "@/components/ui/text";

export default function HomeRoute() {
  return (
    <Screen contentClassName="w-full max-w-[520px] self-center">
      <Typography variant="overline">YOUR SPACE</Typography>
      <Typography variant="display">Welcome back.</Typography>
      <Card.Root elevation="sm">
        <Card.Header>
          <Card.Title>Start where you are</Card.Title>
          <Card.Description>
            There is nothing to complete yet. This foundation is intentionally quiet.
          </Card.Description>
        </Card.Header>
      </Card.Root>
    </Screen>
  );
}
