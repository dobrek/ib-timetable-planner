import { APP_ROLE_VALUES, type AppRole } from "@/shared/config";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui";
import { NO_ACCESS_LABEL, ROLE_LABELS } from "../model/role-labels";

type Props = {
  /** Whose role this is, for the picker's accessible name. */
  name: string;
  role: AppRole | null;
  disabled: boolean;
  onChange: (role: AppRole | null) => void;
};

/** A Select needs a non-empty value for every item, so "No access" has one of its own. */
const NO_ACCESS = "none";

/** One row's role picker: the three roles, then No access. */
export default function RoleSelect({ name, role, disabled, onChange }: Props) {
  return (
    <Select
      value={role ?? NO_ACCESS}
      onValueChange={(value) => {
        onChange(toRole(value));
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-36" aria-label={`Role for ${name}`}>
        {/* The label as children, so the server renders it: Radix fills an empty value only once mounted. */}
        <SelectValue>{role === null ? NO_ACCESS_LABEL : ROLE_LABELS[role]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {APP_ROLE_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {ROLE_LABELS[value]}
          </SelectItem>
        ))}
        <SelectItem value={NO_ACCESS}>{NO_ACCESS_LABEL}</SelectItem>
      </SelectContent>
    </Select>
  );
}

const toRole = (value: string): AppRole | null => APP_ROLE_VALUES.find((role) => role === value) ?? null;
