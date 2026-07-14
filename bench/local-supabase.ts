import { createClient } from "@supabase/supabase-js";
import type { Database, SupabaseClient } from "@/shared/api";

/**
 * The bench runners' service-role client (RLS bypassed), pinned to the LOCAL stack.
 *
 * Both runners print real course, student and teacher identifiers to stdout, and the experiment
 * harness additionally *writes* (clone + persist). A `.env.test.local` left pointing at the hosted
 * project would dump — or mutate — production timetable data, so the local host is asserted, never
 * assumed. `allowRemote` exists for the read-only analyzer's deliberate override; the write path
 * never passes it.
 */
export const createLocalSupabase = ({ allowRemote = false }: { allowRemote?: boolean } = {}): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase env missing — needs the local stack up and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test.local.",
    );
  }
  assertLocalStack(url, allowRemote);
  return createClient<Database>(url, serviceKey);
};

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

const assertLocalStack = (url: string, allowRemote: boolean): void => {
  const { hostname } = new URL(url);
  if (LOCAL_HOSTS.includes(hostname) || allowRemote) return;
  throw new Error(
    `Refusing to run against a non-local Supabase (${hostname}): the bench runners print real names ` +
      `and ids to stdout, and the experiment harness writes. Run 'pnpm env:local' first.`,
  );
};
