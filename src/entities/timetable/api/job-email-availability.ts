import { env } from "cloudflare:workers";
import { readJobEmailConfig } from "./job-email-config";

/**
 * Whether this Worker sends job emails (S-310): the route's half of `readJobEmailConfig`, read from
 * the Worker's module-scope `env`. The plan route computes it and passes it down, as it does
 * `canEdit`, so the Generate dialog offers "Email me when it finishes" only while the cron will act
 * on it. Islands never read env.
 *
 * Separate from the pure reader because `cloudflare:workers` exists only inside workerd, so this file
 * is not unit-testable and must stay out of the entity barrel (see `solver-config.ts`). The route
 * imports it at its own path.
 */
export const isJobEmailAvailable = (): boolean => readJobEmailConfig(env).ok;
