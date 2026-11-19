/**
 * The job email's configuration (S-310): one answer to "is the job email configured here?", shared
 * by the plan route (whether the Generate dialog offers "Email me when it finishes") and the Worker's
 * cron (whether it sweeps at all). One reader means the checkbox and the cron can never disagree: the
 * UI never promises an email nothing will send.
 *
 * Pure, over a plain env object, so it is unit-testable. The Worker's module-scope `env` is read in
 * `job-email-availability.ts` (the route) and from the `scheduled` handler's own argument (the cron),
 * never here: `cloudflare:workers` exists only inside workerd. Like `solver-config.ts`, neither this
 * nor its sibling is in the entity barrel, which React islands pull into the client bundle.
 *
 * It checks presence, not validity. A wrong password still shows the checkbox, and the cron then
 * logs its failed sign-in. The one value it parses is the origin, because every email's one link is
 * built from it.
 */
export type JobEmailEnv = Partial<Record<JobEmailEnvKey, string>>;

export type JobEmailEnvKey =
  | "SUPABASE_URL"
  | "SUPABASE_KEY"
  | "NOTIFIER_MACHINE_EMAIL"
  | "NOTIFIER_MACHINE_PASSWORD"
  | "APP_ORIGIN"
  | "RESEND_API_KEY"
  | "MAILPIT_URL";

/** How the email leaves: Resend's HTTP API in production, Mailpit's locally and in CI. */
export type JobEmailMail = { kind: "resend"; apiKey: string } | { kind: "mailpit"; url: string };

export type JobEmailConfig = {
  supabaseUrl: string;
  /** The publishable key: the notifier signs in with it, like any client. */
  supabaseKey: string;
  notifierEmail: string;
  notifierPassword: string;
  /** Scheme, host and port only, with no trailing slash: every link is `${appOrigin}/plans/<id>`. */
  appOrigin: string;
  mail: JobEmailMail;
};

export type JobEmailConfigResult = { ok: true; config: JobEmailConfig } | { ok: false; problems: string[] };

/** The provisioning script's default (`scripts/provision-notifier-user.mjs`). */
export const DEFAULT_NOTIFIER_EMAIL = "notifier@ib-timetable-planner.dev";

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "NOTIFIER_MACHINE_PASSWORD",
  "APP_ORIGIN",
] as const satisfies readonly JobEmailEnvKey[];

/**
 * The job email's configuration, or every reason it is off. The required keys are `SUPABASE_URL`,
 * `SUPABASE_KEY`, `NOTIFIER_MACHINE_PASSWORD`, `APP_ORIGIN`, and exactly one of `RESEND_API_KEY` and
 * `MAILPIT_URL`. Both transports set is a configuration error, never a silent pick. A blank value
 * counts as missing, since `wrangler dev` passes an emptied `.dev.vars` line as an empty string.
 *
 * The missing keys come first, as one problem (`missing A, B`), so the cron's log line names them all.
 */
export function readJobEmailConfig(env: JobEmailEnv): JobEmailConfigResult {
  const value = (key: JobEmailEnvKey): string | undefined => present(env[key]);
  const resendApiKey = value("RESEND_API_KEY");
  const mailpitUrl = value("MAILPIT_URL");
  const missing = [
    ...REQUIRED.filter((key) => value(key) === undefined),
    ...(resendApiKey === undefined && mailpitUrl === undefined ? ["RESEND_API_KEY or MAILPIT_URL"] : []),
  ];
  const origin = originOf(value("APP_ORIGIN"));
  const problems = [
    ...(missing.length > 0 ? [`missing ${missing.join(", ")}`] : []),
    ...(resendApiKey !== undefined && mailpitUrl !== undefined
      ? ["both RESEND_API_KEY and MAILPIT_URL are set; set exactly one"]
      : []),
    ...(value("APP_ORIGIN") !== undefined && origin === null ? ["APP_ORIGIN is not an http(s) URL"] : []),
  ];
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      supabaseUrl: required(value("SUPABASE_URL")),
      supabaseKey: required(value("SUPABASE_KEY")),
      notifierEmail: value("NOTIFIER_MACHINE_EMAIL") ?? DEFAULT_NOTIFIER_EMAIL,
      notifierPassword: required(value("NOTIFIER_MACHINE_PASSWORD")),
      appOrigin: required(origin),
      mail:
        resendApiKey !== undefined
          ? { kind: "resend", apiKey: resendApiKey }
          : { kind: "mailpit", url: required(mailpitUrl) },
    },
  };
}

const present = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** The URL's origin when it is an http(s) URL, else null. A path or trailing slash is dropped. */
const originOf = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
};

/** Narrows a value the problems check above has already proven present. */
const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("readJobEmailConfig: a checked value is missing");
  return value;
};
