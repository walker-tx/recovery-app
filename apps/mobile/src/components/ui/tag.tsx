import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { Typography } from "./text";
type Variant = "accentTinted" | "accentOutlined" | "neutral" | "danger";
type TagProps = ViewProps & { children: ReactNode; className?: string; variant?: Variant };
const variants: Record<Variant, { tag: string; text: string }> = {
  accentTinted: { tag: "border-blueprint-tint bg-blueprint-tint", text: "text-blueprint-pressed" },
  accentOutlined: { tag: "border-blueprint bg-transparent", text: "text-blueprint-pressed" },
  neutral: { tag: "border-line bg-surface-strong", text: "text-ink-muted" },
  danger: { tag: "border-danger bg-danger-surface", text: "text-danger" },
};
export function Tag({ children, className, variant = "neutral", ...props }: TagProps) { const palette = variants[variant]; return <View className={`self-start rounded-subtle border px-sm py-xs ${palette.tag} ${className ?? ""}`} {...props}><Typography className={`font-bold ${palette.text}`} variant="caption">{children}</Typography></View>; }
