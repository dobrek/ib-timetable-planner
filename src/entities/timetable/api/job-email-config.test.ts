import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFIER_EMAIL, readJobEmailConfig, type JobEmailEnv } from "./job-email-config";

const complete: JobEmailEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_KEY: "sb_publishable_test",
  NOTIFIER_MACHINE_PASSWORD: "a-password-of-some-length",
  APP_ORIGIN: "http://localhost:4321",
  MAILPIT_URL: "http://127.0.0.1:54324",
};

describe("readJobEmailConfig", () => {
  it("reads a complete local configuration, defaulting the notifier's email", () => {
    expect(readJobEmailConfig(complete)).toEqual({
      ok: true,
      config: {
        supabaseUrl: "http://127.0.0.1:54321",
        supabaseKey: "sb_publishable_test",
        notifierEmail: DEFAULT_NOTIFIER_EMAIL,
        notifierPassword: "a-password-of-some-length",
        appOrigin: "http://localhost:4321",
        mail: { kind: "mailpit", url: "http://127.0.0.1:54324" },
      },
    });
    expect(DEFAULT_NOTIFIER_EMAIL).toBe("notifier@ib-timetable-planner.dev");
  });

  it("reads Resend when only its key is set, and a given notifier email", () => {
    const result = readJobEmailConfig({
      ...complete,
      MAILPIT_URL: undefined,
      RESEND_API_KEY: "re_test",
      NOTIFIER_MACHINE_EMAIL: "other@example.test",
    });

    expect(result).toMatchObject({
      ok: true,
      config: { notifierEmail: "other@example.test", mail: { kind: "resend", apiKey: "re_test" } },
    });
  });

  it.each(["SUPABASE_URL", "SUPABASE_KEY", "NOTIFIER_MACHINE_PASSWORD", "APP_ORIGIN"] as const)(
    "names %s when it is missing",
    (key) => {
      expect(readJobEmailConfig({ ...complete, [key]: undefined })).toEqual({
        ok: false,
        problems: [`missing ${key}`],
      });
    },
  );

  it("counts a blank value as missing", () => {
    expect(readJobEmailConfig({ ...complete, NOTIFIER_MACHINE_PASSWORD: "  " })).toEqual({
      ok: false,
      problems: ["missing NOTIFIER_MACHINE_PASSWORD"],
    });
  });

  it("names a missing transport", () => {
    expect(readJobEmailConfig({ ...complete, MAILPIT_URL: undefined })).toEqual({
      ok: false,
      problems: ["missing RESEND_API_KEY or MAILPIT_URL"],
    });
  });

  it("names every missing key in one problem, so one log line says them all", () => {
    expect(readJobEmailConfig({})).toEqual({
      ok: false,
      problems: [
        "missing SUPABASE_URL, SUPABASE_KEY, NOTIFIER_MACHINE_PASSWORD, APP_ORIGIN, RESEND_API_KEY or MAILPIT_URL",
      ],
    });
  });

  it("refuses both transports at once rather than picking one", () => {
    expect(readJobEmailConfig({ ...complete, RESEND_API_KEY: "re_test" })).toEqual({
      ok: false,
      problems: ["both RESEND_API_KEY and MAILPIT_URL are set; set exactly one"],
    });
  });

  it("keeps only the origin of APP_ORIGIN, so a trailing slash never doubles a link's", () => {
    expect(readJobEmailConfig({ ...complete, APP_ORIGIN: "https://ib-timetable-planner.dev/" })).toMatchObject({
      ok: true,
      config: { appOrigin: "https://ib-timetable-planner.dev" },
    });
  });

  it.each(["ib-timetable-planner.dev", "ftp://ib-timetable-planner.dev", "javascript:alert(1)"])(
    "refuses an APP_ORIGIN that is not an http(s) URL: %s",
    (origin) => {
      expect(readJobEmailConfig({ ...complete, APP_ORIGIN: origin })).toEqual({
        ok: false,
        problems: ["APP_ORIGIN is not an http(s) URL"],
      });
    },
  );
});
