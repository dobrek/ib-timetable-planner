import type { CatalogSnapshot } from "./types";

/**
 * Stable SHA-256 (Web Crypto — edge-safe on workerd, global in Node) over a
 * canonical, sorted serialization of the catalog projection. The `GroupingCourse[]`
 * projection already folds overlaps and merges into each course's `studentKeys`, so
 * any change to course meta, choices, overlaps, or merges shifts the hash. Sorting
 * courses by id and student keys within each course makes the hash order-insensitive.
 *
 * The single hash implementation — never replicate this in SQL (a second
 * implementation can silently drift; see plan.md Critical Implementation Details).
 */
export const computeCatalogHash = async (snapshot: CatalogSnapshot): Promise<string> => {
  const canonical = JSON.stringify(
    snapshot
      .map((course) => ({
        id: course.id,
        teacherKeys: [...course.teacherKeys].sort(),
        hours: course.hours,
        studentKeys: [...course.studentKeys].sort(),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
