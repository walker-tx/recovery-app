import { resolveFontFace } from "@/theme/font-face";
import { cssInterop } from "nativewind";
import { StyleSheet, Text as NativeText, type TextProps as NativeTextProps } from "react-native";

export type TypographyVariant = "display" | "title" | "heading" | "body" | "label" | "caption" | "overline";
export type TypographyProps = NativeTextProps & { variant?: TypographyVariant; className?: string };

const variants: Record<TypographyVariant, string> = {
  display: "text-display text-ink",
  title: "text-title text-ink",
  heading: "text-heading text-ink",
  body: "text-body text-ink",
  label: "text-label text-ink",
  caption: "text-caption text-ink-muted",
  overline: "text-overline text-blueprint",
};

function ResolvedTypography({ variant = "body", style, ...props }: TypographyProps) {
  const heading = ["display", "title", "heading", "overline"].includes(variant) || props.accessibilityRole === "header";
  const face = resolveFontFace(StyleSheet.flatten(style) ?? {}, heading, variant === "label");
  return <NativeText allowFontScaling {...props} style={[style, face]} />;
}

// Resolve className before selecting a face, using NativeWind's standard cascade.
const InteropTypography = cssInterop(ResolvedTypography, { className: "style" });

export function Typography({ className, variant = "body", ...props }: TypographyProps) {
  return <InteropTypography {...props} variant={variant} className={`${variants[variant]} ${className ?? ""}`} />;
}

export const Text = Typography;
