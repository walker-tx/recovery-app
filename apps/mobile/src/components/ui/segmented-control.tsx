import { Children, createContext, use, type ReactNode } from "react";
import {
  Pressable,
  View,
  type PressableProps,
  type ViewProps,
} from "react-native";

import { Typography } from "./text";
type ContextValue = {
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
};
const SegmentedContext = createContext<ContextValue | null>(null);
type RootProps = ViewProps & {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  value: string;
};
function Root({
  children,
  className,
  disabled = false,
  onValueChange,
  value,
  ...props
}: RootProps) {
  return (
    <SegmentedContext value={{ value, onValueChange, disabled }}>
      <View
        accessibilityRole="tablist"
        className={`flex-row overflow-hidden rounded-subtle border border-line bg-surface ${className ?? ""}`}
        {...props}
      >
        {children}
      </View>
    </SegmentedContext>
  );
}
type ItemProps = Omit<PressableProps, "children" | "onPress"> & {
  children: ReactNode;
  className?: string;
  value: string;
};
function Item({
  children,
  className,
  disabled = false,
  value,
  ...props
}: ItemProps) {
  const context = use(SegmentedContext);
  if (!context) {
    throw new Error(
      "SegmentedControl.Item must be inside SegmentedControl.Root",
    );
  }
  const selected = context.value === value;
  const unavailable = Boolean(context.disabled || disabled);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ disabled: unavailable, selected }}
      className={`min-h-touch flex-1 items-center justify-center px-md active:opacity-[0.78] ${selected ? "bg-blueprint" : ""} ${unavailable ? "opacity-[0.45]" : ""} ${className ?? ""}`}
      disabled={unavailable}
      onPress={() => context.onValueChange(value)}
      {...props}
    >
      <View className="flex-row items-center justify-center gap-sm">
        {Children.map(children, (child) =>
          typeof child === "string" || typeof child === "number" ? (
            <Typography
              className={selected ? "text-inverse" : undefined}
              variant="label"
            >
              {child}
            </Typography>
          ) : (
            child
          ),
        )}
      </View>
    </Pressable>
  );
}
export const SegmentedControl = { Root, Item };
