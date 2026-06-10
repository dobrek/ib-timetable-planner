import type * as React from "react";
import { Input } from "./input";

type NumberFieldProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
};

/**
 * Controlled numeric input for RHF number fields — spread the controller field into it:
 * `<NumberField min={0} {...field} />`. An empty input maps to `undefined` so the Zod
 * resolver reports "required" rather than NaN; a non-finite value renders as empty.
 */
export function NumberField({ value, onChange, ...props }: NumberFieldProps) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      onChange={(event) => {
        onChange(toNumberOrUndefined(event.target.value));
      }}
      {...props}
    />
  );
}

const toNumberOrUndefined = (raw: string): number | undefined => (raw === "" ? undefined : Number(raw));
