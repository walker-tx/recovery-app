import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from "react-native";

export type TypographyVariant =
  | "display"
  | "title"
  | "heading"
  | "body"
  | "label"
  | "caption"
  | "overline";
export type TypographyProps = NativeTextProps & {
  variant?: TypographyVariant;
  className?: string;
};

const variants: Record<TypographyVariant, string> = {
  display: "text-display text-ink",
  title: "text-title text-ink",
  heading: "text-heading text-ink",
  body: "text-body text-ink",
  label: "text-label text-ink",
  caption: "text-caption text-ink-muted",
  overline: "text-overline text-blueprint",
};

export function Typography({
  className,
  variant = "body",
  ...props
}: TypographyProps) {
  return (
    <NativeText
      allowFontScaling
      className={`${variants[variant]} ${className ?? ""}`}
      {...props}
    />
  );
}

export const Text = Typography;
