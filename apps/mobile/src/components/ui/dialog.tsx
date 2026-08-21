import type { ComponentProps, ReactNode } from "react";
import { Modal, Pressable, View, type ModalProps, type StyleProp, type ViewStyle, type ViewProps } from "react-native";

import { Typography } from "./text";

type RootProps = Omit<ModalProps, "children" | "transparent"> & { children: ReactNode; contentClassName?: string; contentStyle?: StyleProp<ViewStyle> };
type SectionProps = ViewProps & { children: ReactNode; className?: string };
function Root({ animationType = "fade", children, contentClassName, contentStyle, onRequestClose, ...props }: RootProps) {
  return (
    <Modal animationType={animationType} onRequestClose={onRequestClose} transparent {...props}>
      <View accessibilityViewIsModal className="flex-1 items-center justify-center bg-overlay p-xl">
        <Pressable accessibilityLabel="Close dialog" accessibilityRole="button" className="absolute inset-0" onPress={onRequestClose} />
        <View className={`w-full max-w-[440px] gap-lg rounded-subtle border border-line-strong bg-surface p-xl shadow-lg ${contentClassName ?? ""}`} style={contentStyle}>{children}</View>
      </View>
    </Modal>
  );
}
function Title(props: Omit<ComponentProps<typeof Typography>, "variant">) { return <Typography accessibilityRole="header" variant="title" {...props} />; }
function Description(props: Omit<ComponentProps<typeof Typography>, "variant">) { return <Typography variant="body" {...props} />; }
function Content({ children, className, ...props }: SectionProps) { return <View className={`gap-md ${className ?? ""}`} {...props}>{children}</View>; }
function Actions({ children, className, ...props }: SectionProps) { return <View className={`flex-row flex-wrap justify-end gap-sm ${className ?? ""}`} {...props}>{children}</View>; }
export const Dialog = { Root, Title, Description, Content, Actions };
