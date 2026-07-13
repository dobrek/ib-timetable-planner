// ---------------------------------------------------------------------------
// Deterministic seed ids (RFC 4122 UUIDv5, SHA-1 over a fixed namespace).
//
// The seed used to mint `randomUUID()`s, which made `supabase/seed.sql` a
// snapshot of one lucky run: regenerating it produced a byte-different file
// with entirely new ids. Anything that addressed a seed row BY ID was then
// only correct against the committed copy — CI regenerates the seed before
// `supabase start`, so `bench:generation`'s plan-id lookup found nothing.
//
// Content-addressing fixes that at the root: the same catalog always yields the
// same ids, so the committed seed and a fresh regeneration agree, and "plans by
// id, never by name" holds in CI as well as locally. Keying by CONTENT (not by
// call order) also keeps regeneration diffs minimal — adding a course shifts
// only that course's row, instead of every uuid below it.
//
// These ids are dev-fixture identifiers only; they never reach the hosted
// project (the seed is local-only and is never applied to prod).
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";

/** Fixed namespace for this project's seed fixtures. Changing it re-mints every seed id. */
const SEED_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";

/**
 * A stable UUIDv5 for the given key parts. Parts are joined with `|`, so callers must pass parts
 * that together identify the row uniquely within the seed (e.g. plan name, cohort, entity kind,
 * natural key) — two different rows sharing a key would collide on the primary key.
 */
export function seedId(...parts) {
  const name = parts.join("|");
  const namespaceBytes = Buffer.from(SEED_NAMESPACE.replaceAll("-", ""), "hex");
  const hash = createHash("sha1").update(namespaceBytes).update(Buffer.from(name, "utf8")).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
