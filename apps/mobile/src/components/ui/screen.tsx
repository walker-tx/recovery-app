import type { ReactNode } from "react";
import { ScrollView, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ScreenProps = Omit<ScrollViewProps, "contentContainerStyle" | "className"> & { children: ReactNode; className?: string; contentClassName?: string; contentContainerStyle?: StyleProp<ViewStyle>; scrollClassName?: string };
export function Screen({ children, className, contentClassName, contentContainerStyle, keyboardShouldPersistTaps = "handled", scrollClassName, ...props }: ScreenProps) {
  return (
    <SafeAreaView className={`flex-1 bg-canvas ${className ?? ""}`}>
      <ScrollView
        className={`bg-canvas ${scrollClassName ?? ""}`}
        contentContainerClassName={`flex-grow justify-center gap-lg p-xl ${contentClassName ?? ""}`}
        contentContainerStyle={contentContainerStyle}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >{children}</ScrollView>
    </SafeAreaView>
  );
}
