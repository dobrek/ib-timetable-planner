declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /**
     * The caller's role, read live by the middleware on every gated page and every action (S-403).
     * Public paths skip the read and hold `{ status: "none" }`. Interpreted by `resolveAccess`.
     */
    access: import("@/shared/config").AccessState;
    /**
     * The Worker's `ExecutionContext`, which `@astrojs/cloudflare` puts on every request's locals.
     * `waitUntil` keeps work running after the response is sent (S-402's reset request). Typed from
     * the hand-written `src/cloudflare-env.d.ts` — never `wrangler types`.
     */
    cfContext: ExecutionContext;
  }
}
