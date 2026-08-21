import type { ReactNode } from "react";
import { ScrollView, View, type ViewProps } from "react-native";

import { Typography } from "./text";
type ContainerProps = ViewProps & { children: ReactNode; className?: string };
function Root({ children, className, minWidth = 560, style, ...props }: ContainerProps & { minWidth?: number }) { return <ScrollView accessibilityRole="none" horizontal showsHorizontalScrollIndicator><View className={`overflow-hidden rounded-subtle border border-line bg-surface ${className ?? ""}`} style={[{ minWidth }, style]} {...props}>{children}</View></ScrollView>; }
function Header({ children, className, ...props }: ContainerProps) { return <View accessibilityRole="header" className={`flex-row border-b border-line bg-surface-strong ${className ?? ""}`} {...props}>{children}</View>; }
function Row({ children, className, ...props }: ContainerProps) { return <View className={`flex-row border-b border-line ${className ?? ""}`} {...props}>{children}</View>; }
function Cell({ children, className, numeric = false, style, width = 160, ...props }: ContainerProps & { numeric?: boolean; width?: number }) { return <View className={`min-h-[44px] justify-center px-md py-sm ${className ?? ""}`} style={[{ width }, style]} {...props}><Typography className={numeric ? "text-right tabular-nums" : undefined} selectable variant="caption">{children}</Typography></View>; }
function HeaderCell({ children, className, style, width = 160, ...props }: ContainerProps & { width?: number }) { return <View className={`min-h-[44px] justify-center px-md py-sm ${className ?? ""}`} style={[{ width }, style]} {...props}><Typography variant="label">{children}</Typography></View>; }
export const Table = { Root, Header, HeaderCell, Row, Cell };
