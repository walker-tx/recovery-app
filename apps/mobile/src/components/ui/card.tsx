import type { ComponentProps, ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { Typography } from "./text";

type Elevation = "none" | "sm" | "md" | "lg";
type SectionProps = ViewProps & { children: ReactNode; className?: string };
const elevations: Record<Elevation, string> = { none: "", sm: "shadow-sm", md: "shadow-md", lg: "shadow-lg" };

function Root({ children, className, elevation = "none", ...props }: SectionProps & { elevation?: Elevation }) {
  return <View className={`gap-lg rounded-subtle border border-line bg-surface p-xl ${elevations[elevation]} ${className ?? ""}`} {...props}>{children}</View>;
}
function Header({ children, className, ...props }: SectionProps) { return <View className={`gap-sm ${className ?? ""}`} {...props}>{children}</View>; }
function Title(props: Omit<ComponentProps<typeof Typography>, "variant">) { return <Typography variant="heading" {...props} />; }
function Description(props: Omit<ComponentProps<typeof Typography>, "variant">) { return <Typography variant="caption" {...props} />; }
function Content({ children, className, ...props }: SectionProps) { return <View className={`gap-sm ${className ?? ""}`} {...props}>{children}</View>; }
function Footer({ children, className, ...props }: SectionProps) { return <View className={`flex-row flex-wrap items-center gap-sm ${className ?? ""}`} {...props}>{children}</View>; }
export const Card = { Root, Header, Title, Description, Content, Footer };
