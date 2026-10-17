import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type ComponentProps } from "react";
import { cn } from "@/shared/lib/class-names";
import { Input } from "./input";

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  /**
   * Names the toggle "Show <toggleLabel>" / "Hide <toggleLabel>". Give each field on a page its own,
   * so two toggles never share an accessible name.
   */
  toggleLabel: string;
};

/**
 * A password field with a show/hide toggle. The toggle's label states what pressing it does, and
 * `aria-controls` points at the field. The id is optional because `FormControl` injects one.
 */
function PasswordInput({ id, toggleLabel, className, ...props }: PasswordInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input id={inputId} type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <button
        type="button"
        onClick={() => {
          setVisible(!visible);
        }}
        aria-label={`${visible ? "Hide" : "Show"} ${toggleLabel}`}
        aria-controls={inputId}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

export { PasswordInput };
