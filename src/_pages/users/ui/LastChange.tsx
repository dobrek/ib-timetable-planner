import { useHydrated } from "@/shared/lib/use-hydrated";
import type { ChangedBy, UserRow } from "../model/user-rows";

type Props = { change: UserRow["lastChange"] };

/**
 * "Changed by <who> · <when>", or a dash when no change is recorded. The time is the reader's own,
 * so it renders only after hydration: the server runs in UTC (see `useHydrated`).
 */
export default function LastChange({ change }: Props) {
  const hydrated = useHydrated();
  if (!change) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="text-muted-foreground text-sm">
      Changed by <span className="text-foreground">{actorName(change.by)}</span> ·{" "}
      <time dateTime={change.at}>{hydrated ? formatWhen(change.at) : null}</time>
    </span>
  );
}

const actorName = (by: ChangedBy): string => {
  if (by.kind === "user") return by.label.primary;
  return by.kind === "operator" ? "Operator" : "Deleted user";
};

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
