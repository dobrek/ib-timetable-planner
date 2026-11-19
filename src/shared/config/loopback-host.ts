/**
 * The hostnames that name this machine, as `URL.hostname` spells them (it keeps the brackets on an
 * IPv6 literal). The one list behind every "local only" gate the app enforces: Turnstile accepts
 * Cloudflare's test secrets only here, and the job email sends through Mailpit only here.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether `hostname` is this machine. Pass `URL.hostname`, never a host with a port. */
export const isLoopbackHost = (hostname: string): boolean => LOOPBACK_HOSTS.has(hostname);
