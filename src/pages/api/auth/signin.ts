import type { APIRoute } from "astro";
import { createClient } from "@/shared/api";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  // GoTrue enforces the 15-character floor only when a password is set, so an older, shorter one
  // still signs in; it says so in `weakPassword`, and the dashboard turns that into a nudge.
  return context.redirect(data.weakPassword ? "/dashboard?notice=weak-password" : "/dashboard");
};
