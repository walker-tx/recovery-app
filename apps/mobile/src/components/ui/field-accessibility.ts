type FieldAccessibilityHintInput = {
  accessibilityHint?: string;
  description?: string;
  error?: string | null;
};

export function getFieldAccessibilityHint({
  accessibilityHint,
  description,
  error,
}: FieldAccessibilityHintInput) {
  const fieldMessage = error || description;
  const parts = [accessibilityHint, fieldMessage].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(" ") : undefined;
}
