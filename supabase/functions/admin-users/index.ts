import { withSupabase } from "@supabase/server";
import { handle } from "./handler.ts";

// `auth: "user"` verifies the caller's JWT against the project's JWKS and answers 401 for anything
// else (no token, the publishable key as a Bearer, a forged token). It does NOT mean "a human": the
// solver's machine token passes it too, so `handle` goes on to require a live `admin` role before it
// touches the secret-key client. `verify_jwt` is false in config.toml on purpose: the platform check
// only understands the legacy HS256 keys and this project's tokens are ES256.
//
// CORS is off: only the Worker calls this, server to server, and a browser never should.
export default {
  fetch: withSupabase({ auth: "user", cors: "disabled" }, (req, ctx) => handle(req, ctx)),
};
