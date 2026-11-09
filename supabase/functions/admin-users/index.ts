import { withSupabase } from "@supabase/server";

// Skeleton (S-409 Phase 2): proves the toolchain, the CI stack and the deploy step can host a
// function. It answers a fixed placeholder and touches no data. `auth: "none"` is correct ONLY for
// this placeholder — Phase 4 replaces it with `auth: "user"` plus the live admin check.
export default {
  fetch: withSupabase({ auth: "none" }, () => {
    return Promise.resolve(Response.json({ status: "placeholder" }));
  }),
};
