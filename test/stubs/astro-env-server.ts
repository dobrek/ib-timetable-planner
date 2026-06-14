// Vitest stub for Astro's `astro:env/server` virtual module.
//
// The `@/shared/api` barrel re-exports `createClient` from `supabase.ts`, which
// reads these bindings at module load. Steiger forbids deep imports into
// `shared/api`, so unit-tested slice code reaches postgrest helpers through the
// barrel — dragging this virtual module into the Vitest graph. Tests inject fake
// Supabase clients and never call `createClient`, so empty bindings are enough.
export const SUPABASE_URL: string | undefined = undefined;
export const SUPABASE_KEY: string | undefined = undefined;
