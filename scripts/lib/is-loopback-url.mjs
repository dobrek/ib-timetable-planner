// The local stack's hosts: the same set src/test/factories/create-signed-in-user.ts accepts. An
// operator script that mints a sign-in-ready account, or hands one access, checks this before it
// sends a request.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Whether `url` points at the local stack. An unparseable URL is not loopback.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isLoopbackUrl(url) {
  return URL.canParse(url) && LOOPBACK_HOSTS.has(new URL(url).hostname);
}
