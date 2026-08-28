import { useId, type ReactNode, type Ref } from "react";
import { TextInput, View, type TextInputProps, type ViewProps } from "react-native";

import { colors } from "@/theme/tokens";
import { getFieldAccessibilityHint } from "./field-accessibility";
import { Typography } from "./text";

type FieldProps = ViewProps & { label: string; children: ReactNode; className?: string; description?: string; error?: string | null; required?: boolean };
export function Field({ children, className, description, error, label, required, ...props }: FieldProps) {
  return (
    <View className={`gap-sm ${className ?? ""}`} {...props}>
      <Typography variant="label">{label}{required ? " *" : ""}</Typography>
      {children}
      {error ? <Typography accessibilityLiveRegion="polite" accessibilityRole="alert" className="text-danger" selectable variant="caption">{error}</Typography> : description ? <Typography variant="caption">{description}</Typography> : null}
    </View>
  );
}

type TextFieldProps = TextInputProps & { label: string; ref?: Ref<TextInput>; appearance?: "outlined" | "filled"; description?: string; endAdornment?: ReactNode; error?: string | null; required?: boolean; containerClassName?: string; containerStyle?: ViewProps["style"] };
export function TextField({ accessibilityHint: providedAccessibilityHint, appearance = "outlined", className, containerClassName, containerStyle, description, endAdornment, error, label, required, ...props }: TextFieldProps) {
  const id = useId();
  const accessibilityHint = getFieldAccessibilityHint({
    accessibilityHint: providedAccessibilityHint,
    description,
    error,
  });
  const borderClassName = error
    ? "border-2 border-danger"
    : appearance === "filled" ? "border-transparent" : "border-line";
  return (
    <Field className={containerClassName} description={description} error={error} label={label} required={required} style={containerStyle}>
      <View className={`min-h-touch flex-row items-stretch overflow-hidden rounded-subtle border bg-surface ${borderClassName}`}>
        <TextInput
          accessibilityHint={accessibilityHint}
          accessibilityLabel={label}
          accessibilityState={{ disabled: props.editable === false }}
          className={`min-h-touch flex-1 bg-transparent px-md py-md text-body text-ink ${className ?? ""}`}
          nativeID={id}
          placeholderTextColor={colors.inkMuted}
          {...props}
        />
        {endAdornment ? (
          <View className="justify-center">
            {endAdornment}
          </View>
        ) : null}
      </View>
    </Field>
  );
}
