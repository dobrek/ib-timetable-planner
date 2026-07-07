/**
 * The italic "optional" text cue rendered beside a chip/card course name — the text half of the
 * optional visual axis (`optionalChipClass` in `shared/config` is the border/dim half). Text-only,
 * token-based, and never a tone: a collision badge next to it keeps full strength. One home so the
 * editing board and the read-only perspectives render the same wording, slot, and style; callers
 * guard rendering on the flag.
 */
export function OptionalTag() {
  return (
    <span data-slot="optional-tag" className="text-muted-foreground shrink-0 text-[10px] italic">
      optional
    </span>
  );
}
