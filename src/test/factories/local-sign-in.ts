import { readPublishableKey } from "@/test/publishable-key";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The local stack's URL, refused unless it names a loopback host. The factories that sign users in
 * call it before sending any request: the users they create can sign in, so they are local-only.
 */
export const requireLoopbackUrl = (caller: string): string => {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error(`${caller}: SUPABASE_URL is not set`);
  const { hostname } = new URL(url);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`${caller}: refusing non-loopback host "${hostname}" — signed-in users are local-only`);
  }
  return url;
};

/** The stack's publishable key, the only key a signed-in client ever holds. */
export const requirePublishableKey = (caller: string): string => {
  const key = readPublishableKey();
  if (!key) throw new Error(`${caller}: no publishable key (SUPABASE_KEY, .dev.vars or .env.local)`);
  return key;
};
