// Slice root barrel. The Astro route (`src/pages/plans/compare.astro`) imports the island by direct
// path and the loader from the `api` segment barrel — the `plans-list` precedent, per Astro's FSD
// exception. Kept deliberately empty of `ui/` re-exports so `bench/` can import `./api` without ever
// pulling React into a Vitest node run.
export {};
