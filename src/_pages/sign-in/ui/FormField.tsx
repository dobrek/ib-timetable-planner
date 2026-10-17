import type { ChangeEvent, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Input, Label, PasswordInput } from "@/shared/ui";

type FormFieldProps = {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  hint?: ReactNode;
  icon: ReactNode;
};

export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  error,
  hint,
  icon,
}: FormFieldProps) {
  const inputProps = {
    id,
    name: name ?? id,
    value,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    placeholder,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    className: "pl-10",
  };

  return (
    <div>
      <Label htmlFor={id} className="mb-1 block text-sm">
        {label}
      </Label>
      <div className="relative">
        {/* z-10: PasswordInput's own positioned wrapper paints after this icon and would cover it. */}
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2">
          {icon}
        </span>
        {type === "password" ? (
          <PasswordInput {...inputProps} toggleLabel="password" />
        ) : (
          <Input {...inputProps} type={type} />
        )}
      </div>
      {error ? (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
