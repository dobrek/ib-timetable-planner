import { useEffect, useRef, useState } from "react";
import { criterionId, type LensCriterion } from "../../model/lens";

type Props = {
  /** COMMITTED criteria only — announcements key off their identity, never the preview. */
  criteria: LensCriterion[];
  /** The visible-cohort union total at the time of the change. */
  total: number;
};

/**
 * The lens's one polite live region, PERMANENTLY mounted in the shell (a region that mounts with
 * the lens bar would be registered too late for the first-criterion announcement and unmount before
 * "Lens cleared"). Announces only when the committed criteria change — the match total while
 * criteria exist, "Lens cleared" on clear; preview (highlight) changes and placement edits never
 * announce.
 */
export default function LensAnnouncer({ criteria, total }: Props) {
  const message = useLensAnnouncement(criteria, total);
  return (
    <div role="status" aria-live="polite" data-slot="lens-status" className="sr-only print:hidden">
      {message}
    </div>
  );
}

// Derives the announcement from committed-criteria identity: the signature ref gates the effect so
// a total-only change (preview merge, placement edit) re-runs it but announces nothing.
function useLensAnnouncement(criteria: LensCriterion[], total: number): string {
  const [message, setMessage] = useState("");
  const signature = criteria.map(criterionId).join("|");
  const lastSignature = useRef("");
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    // The guard means an empty signature here is a real clear (it was non-empty before).
    // The criteria count prefix keeps the string unique across criteria changes that leave the
    // total unchanged — an unchanged string is a no-op DOM write, which screen readers skip.
    setMessage(signature === "" ? "Lens cleared" : announcementText(criteria.length, total));
  }, [signature, criteria.length, total]);
  return message;
}

const announcementText = (count: number, total: number): string => {
  const criteriaText = `${count} ${count === 1 ? "criterion" : "criteria"}`;
  if (total === 0) return `${criteriaText} — no placements match the lens`;
  return `${criteriaText} — ${total} ${total === 1 ? "placement" : "placements"} highlighted`;
};
