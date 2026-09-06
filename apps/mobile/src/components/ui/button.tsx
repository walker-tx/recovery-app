import { Children, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  View,
  type PressableProps,
} from "react-native";

import { colors } from "@/theme/tokens";
import { Typography } from "./text";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "default" | "icon";
type ButtonProps = Omit<PressableProps, "children"> & {
  children: ReactNode;
  className?: string;
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const variants = {
  primary: {
    button: "border-blueprint bg-blueprint active:bg-blueprint-pressed",
    text: "text-inverse",
    spinner: colors.inverse,
  },
  secondary: {
    button: "border-line bg-transparent active:bg-surface-strong",
    text: "text-ink",
    spinner: colors.ink,
  },
  ghost: {
    button: "border-transparent bg-transparent active:bg-blueprint-tint",
    text: "text-blueprint-pressed",
    spinner: colors.blueprintPressed,
  },
} as const;

export function Button({
  children,
  className,
  disabled,
  loading = false,
  size = "default",
  variant = "primary",
  ...props
}: ButtonProps) {
  const palette = variants[variant];
  const unavailable = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      className={`min-h-touch items-center justify-center rounded-subtle border px-xl py-md ${palette.button} ${size === "icon" ? "w-touch px-0" : ""} ${unavailable ? "opacity-[0.45]" : ""} ${className ?? ""}`}
      disabled={unavailable}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={palette.spinner} />
      ) : (
        <View className="flex-row items-center justify-center gap-sm">
          {Children.map(children, (child) =>
            typeof child === "string" || typeof child === "number" ? (
              <Typography
                className={palette.text}
                variant="label"
              >
                {child}
              </Typography>
            ) : (
              child
            ),
          )}
        </View>
      )}
    </Pressable>
  );
}
