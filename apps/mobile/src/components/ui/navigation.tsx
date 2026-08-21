import type { ReactNode } from "react";
import { Pressable, View, type PressableProps, type ViewProps } from "react-native";

import { Typography } from "./text";
type ContainerProps = ViewProps & { children: ReactNode; className?: string };
function Root({ children, className, ...props }: ContainerProps) { return <View accessibilityRole="toolbar" className={`min-h-touch flex-row items-center gap-lg border-b border-line px-lg ${className ?? ""}`} {...props}>{children}</View>; }
function Brand({ children, className }: { children: ReactNode; className?: string }) { return <Typography className={`flex-1 ${className ?? ""}`} variant="heading">{children}</Typography>; }
function Items({ children, className, ...props }: ContainerProps) { return <View className={`flex-row items-center gap-xs ${className ?? ""}`} {...props}>{children}</View>; }
type ItemProps = Omit<PressableProps, "children"> & { active?: boolean; children: ReactNode; className?: string };
function Item({ active = false, children, className, disabled, ...props }: ItemProps) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled), selected: active }} className={`min-h-touch items-center justify-center px-md active:bg-surface-strong ${active ? "border-b-2 border-blueprint" : ""} ${disabled ? "opacity-[0.45]" : ""} ${className ?? ""}`} disabled={disabled} {...props}><Typography className={active ? "text-blueprint-pressed" : undefined} variant="label">{children}</Typography></Pressable>;
}
export const Navigation = { Root, Brand, Items, Item };
