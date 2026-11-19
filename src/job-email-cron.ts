import { readJobEmailConfig, type JobEmailConfig, type JobEmailEnv } from "@/entities/timetable/api/job-email-config";
import { sweepJobEmails, type JobEmailSweepReport } from "@/entities/timetable/api/job-email-sweep";
import {
  createMachineClient,
  createMailTransport,
  type MailTransport,
  type MailTransportChoice,
  type SupabaseClient,
} from "@/shared/api";
import { JOB_EMAIL_FROM } from "@/shared/config";

/**
 * The Worker's job-email cron (S-310): the `scheduled` half of `src/worker.ts`, fired once a minute
 * by `wrangler.jsonc`'s `triggers.crons`. Each run reads its configuration, signs in as the
 * `job_notifier` machine user, picks the transport, runs one sweep, and logs one counts-only line.
 *
 * - **Config from the handler's own `env` argument,** through `readJobEmailConfig`, the reader the
 *   plan route uses too, so the Generate checkbox and the cron never disagree. Not `astro:env`, whose
 *   initialisation outside a request is unverified.
 * - **Quiet when unconfigured.** Before the hosted secrets exist, and after the kill switch (deleting
 *   `RESEND_API_KEY`), it logs `[job-email] disabled: …` once per isolate and returns. It never throws
 *   every minute.
 * - **Never throws for an expected condition.** A refused sign-in or a failed sweep is logged and the
 *   run ends; the next run tries again. A failed send is the sweep's to retry, not this module's.
 * - **Never logs an address**, nor a plan name: the sweep reports counts only.
 *
 * Top-level beside `worker.ts`, outside steiger's layers, like `solver-container.ts`: it composes an
 * entity's server-only modules with the Worker's env, which no layer may do.
 */
export type JobEmailCronDeps = {
  createClient: (url: string, key: string) => SupabaseClient;
  createTransport: (choice: MailTransportChoice) => MailTransport;
  sweep: typeof sweepJobEmails;
  log: { info: (line: string) => void; warn: (line: string) => void };
};

export type JobEmailCron = (controller: Pick<ScheduledController, "scheduledTime">, env: JobEmailEnv) => Promise<void>;

/** Sign in again this long before the access token expires, so no request runs on a dying token. */
export const SESSION_REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * A cron with its own isolate state: whether `disabled` has been logged, and the signed-in session it
 * reuses. The Worker builds one per isolate (`scheduled` below); a test builds one per case.
 */
export function createJobEmailCron(deps: JobEmailCronDeps = DEFAULT_DEPS): JobEmailCron {
  // Isolate state, owned by this closure alone. It is the point of the factory: the session outlives
  // a run, so one isolate signs in about once an hour rather than once a minute.
  let disabledLogged = false;
  let session: CachedSession | null = null;

  const signedIn = async (config: JobEmailConfig, nowMs: number): Promise<SupabaseClient | null> => {
    if (session !== null && isReusable(session, config, nowMs)) return session.client;
    session = null;
    const client = deps.createClient(config.supabaseUrl, config.supabaseKey);
    // One password grant per run at most, never retried within it. It counts against GoTrue's
    // `token_refresh` bucket (the `/token` endpoint serves password grants too: Supabase's rate-limit
    // docs), not `sign_in_sign_ups`, whatever `supabase/config.toml`'s stock comment suggests. That
    // bucket is shared with every sign-in and refresh leaving the same Cloudflare egress IP, so a 429
    // (`over_request_rate_limit`) only skips this run.
    const { data, error } = await client.auth.signInWithPassword({
      email: config.notifierEmail,
      password: config.notifierPassword,
    });
    if (error) {
      deps.log.warn(
        `[job-email] sign-in failed (${error.code ?? String(error.status ?? "no status")}); skipping this run`,
      );
      return null;
    }
    session = {
      client,
      identity: identityOf(config),
      expiresAtMs: (data.session.expires_at ?? 0) * 1000,
    };
    return client;
  };

  return async (controller, env) => {
    const read = readJobEmailConfig(env);
    if (!read.ok) {
      if (!disabledLogged) deps.log.warn(`[job-email] disabled: ${read.problems.join("; ")}`);
      disabledLogged = true;
      return;
    }
    const { config } = read;
    const nowMs = controller.scheduledTime;
    try {
      const client = await signedIn(config, nowMs);
      if (client === null) return;
      const report = await deps.sweep(client, deps.createTransport(config.mail), {
        origin: config.appOrigin,
        nowMs,
      });
      deps.log.info(`[job-email] ${countsLine(report)}`);
    } catch (error: unknown) {
      // An expired or revoked token surfaces here too, so the next run signs in afresh.
      session = null;
      deps.log.warn(`[job-email] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

type CachedSession = { client: SupabaseClient; identity: string; expiresAtMs: number };

const identityOf = (config: JobEmailConfig): string => `${config.supabaseUrl} ${config.notifierEmail}`;

const isReusable = (cached: CachedSession, config: JobEmailConfig, nowMs: number): boolean =>
  cached.identity === identityOf(config) && cached.expiresAtMs - SESSION_REFRESH_MARGIN_MS > nowMs;

const countsLine = ({ sent, skipped, waiting, deferred, failed }: JobEmailSweepReport): string =>
  `sent=${String(sent)} skipped=${String(skipped)} waiting=${String(waiting)} deferred=${String(deferred)} failed=${String(failed)}`;

const DEFAULT_DEPS: JobEmailCronDeps = {
  createClient: createMachineClient,
  createTransport: (choice) => createMailTransport(choice, { from: JOB_EMAIL_FROM }),
  sweep: sweepJobEmails,
  // Workers Logs is the cron's only trace.
  log: {
    info: (line) => {
      // eslint-disable-next-line no-console -- the counts line, every run
      console.log(line);
    },
    warn: (line) => {
      // eslint-disable-next-line no-console -- disabled, a refused sign-in, or a failed sweep
      console.warn(line);
    },
  },
};

/** The Worker's cron: one instance per isolate, so the `disabled` line and the session are per isolate. */
const jobEmailCron = createJobEmailCron();

/** `src/worker.ts`'s `scheduled` handler. */
export const scheduled = (controller: ScheduledController, env: Env): Promise<void> => jobEmailCron(controller, env);
