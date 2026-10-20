declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /**
     * The Worker's `ExecutionContext`, which `@astrojs/cloudflare` puts on every request's locals.
     * `waitUntil` keeps work running after the response is sent (S-402's reset request). Typed from
     * the hand-written `src/cloudflare-env.d.ts` — never `wrangler types`.
     */
    cfContext: ExecutionContext;
  }
}
