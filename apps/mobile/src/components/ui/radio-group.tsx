import { createContext, use, type ReactNode } from "react";
import { Pressable, View, type PressableProps, type ViewProps } from "react-native";

import { Typography } from "./text";
type ContextValue = { value?: string; onValueChange: (value: string) => void; disabled: boolean };
const RadioContext = createContext<ContextValue | null>(null);
type RootProps = ViewProps & { children: ReactNode; className?: string; disabled?: boolean; label: string; onValueChange: (value: string) => void; value?: string };
function Root({ children, className, disabled = false, label, onValueChange, value, ...props }: RootProps) { return <RadioContext value={{ value, onValueChange, disabled }}><View accessibilityLabel={label} accessibilityRole="radiogroup" className={`gap-xs ${className ?? ""}`} {...props}>{children}</View></RadioContext>; }
type ItemProps = Omit<PressableProps, "children" | "onPress"> & { children: ReactNode; className?: string; description?: string; value: string };
function Item({ children, className, description, disabled = false, value, ...props }: ItemProps) {
  const context = use(RadioContext);
  if (!context) throw new Error("RadioGroup.Item must be inside RadioGroup.Root");
  const checked = context.value === value;
  const unavailable = Boolean(context.disabled || disabled);
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked, disabled: unavailable }} className={`min-h-touch flex-row items-center gap-md py-sm active:opacity-70 ${unavailable ? "opacity-[0.45]" : ""} ${className ?? ""}`} disabled={unavailable} onPress={() => context.onValueChange(value)} {...props}>
      <View className={`h-[22px] w-[22px] items-center justify-center rounded-full border-2 ${checked ? "border-blueprint bg-blueprint" : "border-line-strong"}`}>{checked ? <View className="h-2 w-2 rounded-full bg-inverse" /> : null}</View>
      <View className="flex-1 gap-xs"><Typography variant="label">{children}</Typography>{description ? <Typography variant="caption">{description}</Typography> : null}</View>
    </Pressable>
  );
}
export const RadioGroup = { Root, Item };
