import { describe, expect, it, vi } from "vitest";
import type { JobEmailEnv } from "@/entities/timetable/api/job-email-config";
import type { JobEmailSweepReport } from "@/entities/timetable/api/job-email-sweep";
import type { MailTransport, SupabaseClient } from "@/shared/api";
import { createJobEmailCron, SESSION_REFRESH_MARGIN_MS, type JobEmailCronDeps } from "./job-email-cron";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const HOUR = 60 * 60_000;

const configured: JobEmailEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_KEY: "sb_publishable_test",
  NOTIFIER_MACHINE_PASSWORD: "notifier-password-long-enough",
  APP_ORIGIN: "http://localhost:4321",
  MAILPIT_URL: "http://127.0.0.1:54324",
};

const REPORT: JobEmailSweepReport = {
  sent: 1,
  skipped: 2,
  waiting: 0,
  deferred: 0,
  stoppedBy: null,
  failed: 0,
  failures: [],
};

type SignIn = SupabaseClient["auth"]["signInWithPassword"];

/** A sign-in that succeeds with a token expiring `expiresInMs` after NOW. */
const signingIn = (expiresInMs = HOUR) =>
  vi.fn<SignIn>(() =>
    Promise.resolve({
      data: { session: { expires_at: (NOW + expiresInMs) / 1000 }, user: {} },
      error: null,
    } as unknown as Awaited<ReturnType<SignIn>>),
  );

const refusing = (code: string, status: number) =>
  vi.fn<SignIn>(() =>
    Promise.resolve({ data: { session: null, user: null }, error: { code, status } } as unknown as Awaited<
      ReturnType<SignIn>
    >),
  );

const harness = ({
  signIn = signingIn(),
  sweep = vi.fn<JobEmailCronDeps["sweep"]>(() => Promise.resolve(REPORT)),
}: { signIn?: ReturnType<typeof vi.fn<SignIn>>; sweep?: ReturnType<typeof vi.fn<JobEmailCronDeps["sweep"]>> } = {}) => {
  const info = vi.fn<(line: string) => void>();
  const warn = vi.fn<(line: string) => void>();
  const transport: MailTransport = { send: () => Promise.resolve({ kind: "sent" }) };
  const createClient = vi.fn<JobEmailCronDeps["createClient"]>(
    () => ({ auth: { signInWithPassword: signIn } }) as unknown as SupabaseClient,
  );
  const cron = createJobEmailCron({
    createClient,
    createTransport: () => transport,
    sweep,
    log: { info, warn },
  });
  const tick = (env: JobEmailEnv = configured, scheduledTime = NOW) => cron({ scheduledTime }, env);
  return { tick, info, warn, signIn, sweep, createClient, transport };
};

describe("the job-email cron", () => {
  it("logs disabled once per isolate, not once per run, and touches nothing", async () => {
    const { tick, warn, createClient, sweep } = harness();
    const unconfigured = { ...configured, NOTIFIER_MACHINE_PASSWORD: undefined };

    await tick(unconfigured);
    await tick(unconfigured);
    await tick(unconfigured);

    expect(warn.mock.calls).toEqual([["[job-email] disabled: missing NOTIFIER_MACHINE_PASSWORD"]]);
    expect(createClient).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("names every problem in its one disabled line", async () => {
    const { tick, warn } = harness();

    await tick({ ...configured, APP_ORIGIN: undefined, RESEND_API_KEY: "re_key" });

    expect(warn.mock.calls).toEqual([
      ["[job-email] disabled: missing APP_ORIGIN; both RESEND_API_KEY and MAILPIT_URL are set; set exactly one"],
    ]);
  });

  it("signs in as the notifier, sweeps with the run's clock and origin, and logs counts only", async () => {
    const { tick, info, signIn, sweep, transport } = harness();

    await tick();

    expect(signIn).toHaveBeenCalledExactlyOnceWith({
      email: "notifier@ib-timetable-planner.dev",
      password: "notifier-password-long-enough",
    });
    expect(sweep).toHaveBeenCalledExactlyOnceWith(expect.anything(), transport, {
      origin: "http://localhost:4321",
      nowMs: NOW,
    });
    expect(info.mock.calls).toEqual([["[job-email] sent=1 skipped=2 waiting=0 deferred=0 failed=0"]]);
  });

  it("says why a run stopped sending and why sends failed, each distinct reason once", async () => {
    const stopped: JobEmailSweepReport = {
      ...REPORT,
      deferred: 2,
      stoppedBy: "credential",
      failed: 3,
      failures: [
        { status: 0, name: "no-answer" },
        { status: 422, name: "validation_error" },
        { status: 0, name: "no-answer" },
      ],
    };
    const { tick, info } = harness({ sweep: vi.fn<JobEmailCronDeps["sweep"]>(() => Promise.resolve(stopped)) });

    await tick();

    expect(info.mock.calls).toEqual([
      ["[job-email] sent=1 skipped=2 waiting=0 deferred=2 (credential) failed=3 (0 no-answer, 422 validation_error)"],
    ]);
  });

  it("reuses the session across runs, and signs in again only as the token nears expiry", async () => {
    const { tick, signIn, sweep } = harness();

    await tick(configured, NOW);
    await tick(configured, NOW + 60_000);
    expect(signIn).toHaveBeenCalledTimes(1);

    await tick(configured, NOW + HOUR - SESSION_REFRESH_MARGIN_MS);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it("skips the run without throwing when the sign-in is refused, rate limit included", async () => {
    for (const [code, status] of [
      ["over_request_rate_limit", 429],
      ["invalid_credentials", 400],
    ] as const) {
      const { tick, warn, sweep, signIn } = harness({ signIn: refusing(code, status) });

      await expect(tick()).resolves.toBeUndefined();

      expect(warn.mock.calls).toEqual([[`[job-email] sign-in failed (${code}); skipping this run`]]);
      expect(sweep).not.toHaveBeenCalled();
      // One grant per run, never retried within it.
      expect(signIn).toHaveBeenCalledTimes(1);
    }
  });

  it("logs a failed sweep without throwing, and signs in afresh on the next run", async () => {
    const sweep = vi.fn<JobEmailCronDeps["sweep"]>(() =>
      Promise.reject(new Error("job email: could not read due jobs: JWT expired")),
    );
    const { tick, warn, signIn } = harness({ sweep });

    await expect(tick()).resolves.toBeUndefined();
    expect(warn.mock.calls).toEqual([["[job-email] sweep failed: job email: could not read due jobs: JWT expired"]]);

    await tick(configured, NOW + 60_000);
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("never logs the notifier's password or email, on a refused sign-in or a sweep", async () => {
    const refused = harness({ signIn: refusing("invalid_credentials", 400) });
    const swept = harness();

    await refused.tick();
    await swept.tick();

    const logged = [refused, swept]
      .flatMap(({ info, warn }) => [...info.mock.calls, ...warn.mock.calls])
      .flat()
      .join("\n");
    expect(logged).toContain("[job-email]");
    expect(logged).not.toContain("notifier-password-long-enough");
    expect(logged).not.toContain("notifier@");
  });
});
