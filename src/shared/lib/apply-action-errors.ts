import type { UseFormSetError, FieldValues, Path } from "react-hook-form";

export function applyActionFieldErrors<T extends FieldValues>(
  error: { fields: Record<string, string[]> },
  setError: UseFormSetError<T>,
): void {
  for (const [field, messages] of Object.entries(error.fields)) {
    if (messages.length > 0) {
      setError(field as Path<T>, { message: messages[0] });
    }
  }
}
